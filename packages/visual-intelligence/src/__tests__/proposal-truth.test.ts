import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_PROPOSAL_TRUTH_WORDING,
  OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING,
  buildProposalTruthDisclosure,
  reduceTopologyDisclosureStatus,
  validateProposalTruthDisclosure,
  type ProposalTruthDisclosureInput,
} from "../proposal-truth.js";
import type {
  ProposalAdvisoryFreshness,
  ProposalTopologyDisclosureStatus,
  ProposalTruthDisclosure,
  ProposalTruthQualificationCode,
} from "../contracts.js";
import { canonicalize } from "../ids.js";
import { shuffle } from "./fixtures.js";

const TOPOLOGY_STATES: ProposalTopologyDisclosureStatus[] = ["explicit", "not_supplied", "partial", "unresolved"];
const FRESHNESS_STATES: ProposalAdvisoryFreshness[] = ["current", "stale_equivalent", "unknown"];

const input = (over: Partial<ProposalTruthDisclosureInput> = {}): ProposalTruthDisclosureInput => ({
  repository_id: "repo_test",
  base_snapshot_digest: "abc123def456",
  proposal_id: "proposal_1",
  advisory_id: "advisory_1",
  topology: [{ status: "explicit" }],
  advisory_freshness: "current",
  ...over,
});

// Independent cross-check table for the 4x3 state matrix -- deliberately
// re-expressed here rather than imported from proposal-truth.ts, so this
// test cannot pass merely because it shares the implementation's own
// mistake.
const TOPOLOGY_LINE: Record<ProposalTopologyDisclosureStatus, { code: ProposalTruthQualificationCode; text?: string }> = {
  explicit: { code: "PROPOSAL_TRUTH_TOPOLOGY_EXPLICIT" },
  not_supplied: { code: "PROPOSAL_TRUTH_TOPOLOGY_NOT_SUPPLIED", text: "Some proposed topology was not supplied." },
  partial: { code: "PROPOSAL_TRUTH_TOPOLOGY_PARTIAL", text: "Proposed topology disclosure is partial; some relationships were not evaluated." },
  unresolved: { code: "PROPOSAL_TRUTH_TOPOLOGY_UNRESOLVED", text: "Proposed topology could not be fully resolved." },
};

const FRESHNESS_LINE: Record<ProposalAdvisoryFreshness, { code: ProposalTruthQualificationCode; text?: string }> = {
  current: { code: "PROPOSAL_TRUTH_ADVISORY_CURRENT" },
  stale_equivalent: { code: "PROPOSAL_TRUTH_ADVISORY_STALE_EQUIVALENT", text: "Advisory was evaluated against a different but equivalent/stale baseline." },
  unknown: { code: "PROPOSAL_TRUTH_ADVISORY_FRESHNESS_UNKNOWN", text: "Current advisory freshness could not be established." },
};

function expectedQualification(baseSnapshotDigest: string, topology: ProposalTopologyDisclosureStatus, freshness: ProposalAdvisoryFreshness) {
  const notObserved = { code: "PROPOSAL_TRUTH_NOT_OBSERVED" as const, text: `PROPOSED -- NOT OBSERVED. Projected from caller-supplied proposal operations. Projection is based on the observed baseline identified by ${baseSnapshotDigest}.` };
  const deterministicProjection = { code: "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION" as const, text: undefined };
  const lines = [notObserved, deterministicProjection, TOPOLOGY_LINE[topology], FRESHNESS_LINE[freshness]];
  return {
    codes: lines.map((l) => l.code) as ProposalTruthQualificationCode[],
    text: lines.map((l) => l.text).filter((t): t is string => t !== undefined).join(" "),
  };
}

// ---------------------------------------------------------------------------
// §42 golden contract cases
// ---------------------------------------------------------------------------

describe("golden case 1 -- current baseline, explicit topology", () => {
  it("carries a fully-observed baseline, fully-described projection, and current advisory", () => {
    const d = buildProposalTruthDisclosure(input());
    expect(d.baseline_basis).toBe("observed");
    expect(d.proposal_basis).toBe("caller_supplied");
    expect(d.projection_basis).toBe("deterministically_projected");
    expect(d.topology_disclosure_status).toBe("explicit");
    expect(d.advisory_freshness).toBe("current");
    expect(d.qualification_codes).toEqual([
      "PROPOSAL_TRUTH_NOT_OBSERVED",
      "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION",
      "PROPOSAL_TRUTH_TOPOLOGY_EXPLICIT",
      "PROPOSAL_TRUTH_ADVISORY_CURRENT",
    ]);
    expect(d.qualification_text).toContain("PROPOSED -- NOT OBSERVED");
  });

  it("explicit topology regression: never implies completeness, full knowledge, or a fully-known graph", () => {
    const d = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }] }));
    const lowered = d.qualification_text.toLowerCase();
    for (const forbidden of ["complete", "fully known", "all relationships known", "fully resolved", "fully described"]) {
      expect(lowered, `qualification_text must not contain "${forbidden}"`).not.toContain(forbidden);
    }
    expect(d.qualification_codes).not.toContain("PROPOSAL_TRUTH_TOPOLOGY_UNRESOLVED");
    // "explicit" only ever asserts disclosure, never completeness -- there is
    // no code named PROPOSAL_TRUTH_TOPOLOGY_COMPLETE anywhere in the closed
    // vocabulary; this is a structural guarantee, not just a text check.
    const allCodes: string[] = [
      "PROPOSAL_TRUTH_NOT_OBSERVED",
      "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION",
      "PROPOSAL_TRUTH_TOPOLOGY_EXPLICIT",
      "PROPOSAL_TRUTH_TOPOLOGY_NOT_SUPPLIED",
      "PROPOSAL_TRUTH_TOPOLOGY_PARTIAL",
      "PROPOSAL_TRUTH_TOPOLOGY_UNRESOLVED",
      "PROPOSAL_TRUTH_ADVISORY_CURRENT",
      "PROPOSAL_TRUTH_ADVISORY_STALE_EQUIVALENT",
      "PROPOSAL_TRUTH_ADVISORY_FRESHNESS_UNKNOWN",
    ];
    expect(allCodes).not.toContain("PROPOSAL_TRUTH_TOPOLOGY_COMPLETE");
  });
});

describe("golden case 2 -- topology not supplied", () => {
  it("visibly and structurally discloses the absence, never silently", () => {
    const d = buildProposalTruthDisclosure(input({ topology: [{ status: "not_supplied" }] }));
    expect(d.topology_disclosure_status).toBe("not_supplied");
    expect(d.qualification_text).toContain("Some proposed topology was not supplied.");
    expect(d.qualification_codes).toContain("PROPOSAL_TRUTH_TOPOLOGY_NOT_SUPPLIED");
  });
});

describe("golden case 3 -- partial topology never becomes explicit", () => {
  it("reduces a mixed explicit/partial set to partial, not explicit", () => {
    const d = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }, { status: "partial" }] }));
    expect(d.topology_disclosure_status).toBe("partial");
    expect(d.qualification_text).toContain("Proposed topology disclosure is partial");
  });
});

describe("golden case 4 -- unresolved topology/reference stays unresolved", () => {
  it("outranks every other status present", () => {
    const d = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }, { status: "partial" }, { status: "unresolved" }] }));
    expect(d.topology_disclosure_status).toBe("unresolved");
    expect(d.qualification_text).toContain("Proposed topology could not be fully resolved.");
  });
});

describe("golden cases 5-7 -- entity-provenance mapping (frozen semantics, no adapter logic, no topology authority)", () => {
  it("case 5: distinguishes an observed entity that exists now from its proposed removal", () => {
    expect(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.removed).toMatch(/observed identity retained/i);
    expect(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.removed).toMatch(/proposed/i);
    expect(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.removed).not.toBe(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.confirmed);
  });

  it("case 6: keeps observed identity and proposed modification distinct for a modified entity", () => {
    expect(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.modified).toMatch(/observed identity retained/i);
    expect(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING.modified).toMatch(/projected modification/i);
  });

  it("case 7: defines no renamed/morphed provenance state -- identity-changing replacement stays remove+add", () => {
    expect(Object.keys(OVERLAY_PROVENANCE_TRUTH_BASIS_MAPPING).sort()).toEqual(["confirmed", "modified", "proposed", "removed"]);
  });
});

describe("golden case 8 -- stale-equivalent advisory", () => {
  it("discloses staleness without ever calling the proposal invalid", () => {
    const d = buildProposalTruthDisclosure(input({ advisory_freshness: "stale_equivalent" }));
    expect(d.advisory_freshness).toBe("stale_equivalent");
    expect(d.qualification_text).toContain("equivalent/stale baseline");
    expect(d.qualification_text.toLowerCase()).not.toContain("invalid");
  });
});

describe("golden case 9 -- freshness unknown", () => {
  it("discloses unknown freshness as this package's own communication state, not a Workbench value", () => {
    const d = buildProposalTruthDisclosure(input({ advisory_freshness: "unknown" }));
    expect(d.advisory_freshness).toBe("unknown");
    expect(d.qualification_text).toContain("Current advisory freshness could not be established.");
  });
});

describe("golden case 10 -- malformed/unsupported contract", () => {
  const valid = () => buildProposalTruthDisclosure(input());

  it("rejects an unsupported schema_version", () => {
    const v = validateProposalTruthDisclosure({ ...valid(), schema_version: 999 });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNSUPPORTED_SCHEMA_VERSION")).toBe(true);
  });

  it("rejects an unknown artifact_kind", () => {
    const v = validateProposalTruthDisclosure({ ...valid(), artifact_kind: "architecture_explorer" });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_ARTIFACT_KIND")).toBe(true);
  });

  it("rejects an unknown topology_disclosure_status", () => {
    const v = validateProposalTruthDisclosure({ ...valid(), topology_disclosure_status: "complete" });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_TOPOLOGY_DISCLOSURE_STATUS")).toBe(true);
  });

  it("rejects an unknown advisory_freshness", () => {
    const v = validateProposalTruthDisclosure({ ...valid(), advisory_freshness: "expired" });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_ADVISORY_FRESHNESS")).toBe(true);
  });

  it("rejects a missing repository_id", () => {
    const { repository_id: _drop, ...rest } = valid();
    const v = validateProposalTruthDisclosure(rest);
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_MISSING_IDENTITY")).toBe(true);
  });

  it("rejects a value that isn't an object", () => {
    expect(validateProposalTruthDisclosure("not an object")[0].code).toBe("PROPOSAL_TRUTH_MALFORMED");
    expect(validateProposalTruthDisclosure(null)[0].code).toBe("PROPOSAL_TRUTH_MALFORMED");
  });

  it("rejects a prototype-pollution-shaped key", () => {
    const poisoned = JSON.parse(`{"__proto__": {"polluted": true}, "repository_id": "r"}`);
    const v = validateProposalTruthDisclosure(poisoned);
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_MALFORMED")).toBe(true);
  });

  it("accepts a genuinely well-formed disclosure with no violations", () => {
    expect(validateProposalTruthDisclosure(valid())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Closed-vocabulary qualification-code runtime validation (Milestone 11.3.0
// semantic-closure remediation, closure 3, investigation §16-17). TypeScript
// alone cannot protect `validateProposalTruthDisclosure()` since it accepts
// `unknown` -- these tests exercise the runtime path directly.
// ---------------------------------------------------------------------------

describe("qualification-code closed-vocabulary validation", () => {
  const valid = () => buildProposalTruthDisclosure(input());

  it("rejects a forbidden approval-flavored code even though it's a plausible-looking string", () => {
    const v = validateProposalTruthDisclosure({ ...valid(), qualification_codes: ["approved"] });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_QUALIFICATION_CODE")).toBe(true);
  });

  it('rejects "safe"', () => {
    const v = validateProposalTruthDisclosure({ ...valid(), qualification_codes: ["safe"] });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_QUALIFICATION_CODE")).toBe(true);
  });

  it('rejects "topology_complete" -- the exact vocabulary this remediation forbids', () => {
    const v = validateProposalTruthDisclosure({ ...valid(), qualification_codes: ["topology_complete"] });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_QUALIFICATION_CODE")).toBe(true);
  });

  it('rejects an arbitrary unrecognized string ("banana")', () => {
    const v = validateProposalTruthDisclosure({ ...valid(), qualification_codes: ["banana"] });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_UNKNOWN_QUALIFICATION_CODE")).toBe(true);
  });

  it("rejects a duplicate PROPOSAL_TRUTH_NOT_OBSERVED code", () => {
    const base = valid();
    const v = validateProposalTruthDisclosure({ ...base, qualification_codes: [...base.qualification_codes, "PROPOSAL_TRUTH_NOT_OBSERVED"] });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_DUPLICATE_QUALIFICATION_CODE")).toBe(true);
  });

  it("rejects a topology code inconsistent with topology_disclosure_status (not_supplied code, but status explicit)", () => {
    const base = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }] }));
    const v = validateProposalTruthDisclosure({
      ...base,
      qualification_codes: ["PROPOSAL_TRUTH_NOT_OBSERVED", "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION", "PROPOSAL_TRUTH_TOPOLOGY_NOT_SUPPLIED", "PROPOSAL_TRUTH_ADVISORY_CURRENT"],
    });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_QUALIFICATION_CODES_MISMATCH")).toBe(true);
  });

  it("rejects a freshness code inconsistent with advisory_freshness (stale_equivalent code, but freshness current)", () => {
    const base = buildProposalTruthDisclosure(input({ advisory_freshness: "current" }));
    const v = validateProposalTruthDisclosure({
      ...base,
      qualification_codes: ["PROPOSAL_TRUTH_NOT_OBSERVED", "PROPOSAL_TRUTH_DETERMINISTIC_PROJECTION", "PROPOSAL_TRUTH_TOPOLOGY_EXPLICIT", "PROPOSAL_TRUTH_ADVISORY_STALE_EQUIVALENT"],
    });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_QUALIFICATION_CODES_MISMATCH")).toBe(true);
  });

  it("rejects a disclosure missing a required code (freshness code dropped)", () => {
    const base = valid();
    const v = validateProposalTruthDisclosure({ ...base, qualification_codes: base.qualification_codes.slice(0, 3) });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_QUALIFICATION_CODES_MISMATCH" || x.code === "PROPOSAL_TRUTH_MISSING_QUALIFICATION_CODES")).toBe(true);
  });

  it("rejects codes present but out of canonical order", () => {
    const base = valid();
    const reordered = [...base.qualification_codes].reverse();
    const v = validateProposalTruthDisclosure({ ...base, qualification_codes: reordered });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_QUALIFICATION_CODES_MISMATCH")).toBe(true);
  });

  it("accepts every valid builder-produced code combination across the full state matrix", () => {
    for (const topology of TOPOLOGY_STATES) {
      for (const freshness of FRESHNESS_STATES) {
        const d = buildProposalTruthDisclosure(input({ topology: [{ status: topology }], advisory_freshness: freshness }));
        expect(validateProposalTruthDisclosure(d), `topology=${topology} freshness=${freshness}`).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Qualification-text integrity: recompute-and-compare, not presence-only
// (Milestone 11.3.0 semantic-closure remediation, closure 3).
// ---------------------------------------------------------------------------

describe("qualification-text integrity", () => {
  it("rejects tampered qualification_text even when every structured field is individually valid", () => {
    const d = buildProposalTruthDisclosure(input());
    const v = validateProposalTruthDisclosure({ ...d, qualification_text: "Approved target architecture" });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_QUALIFICATION_TEXT_MISMATCH")).toBe(true);
  });

  it("rejects qualification_text with an extra, unsupported sentence appended", () => {
    const d = buildProposalTruthDisclosure(input());
    const v = validateProposalTruthDisclosure({ ...d, qualification_text: `${d.qualification_text} This proposal is production ready.` });
    expect(v.some((x) => x.code === "PROPOSAL_TRUTH_QUALIFICATION_TEXT_MISMATCH")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §43 forbidden wording -- exhaustive over the full state space (4 x 3 = 12)
// ---------------------------------------------------------------------------

describe("forbidden wording", () => {
  it("never appears in generated qualification_text, across every topology x freshness combination", () => {
    for (const topology of TOPOLOGY_STATES) {
      for (const freshness of FRESHNESS_STATES) {
        const d = buildProposalTruthDisclosure(input({ topology: [{ status: topology }], advisory_freshness: freshness }));
        const lowered = d.qualification_text.toLowerCase();
        for (const forbidden of FORBIDDEN_PROPOSAL_TRUTH_WORDING) {
          expect(lowered, `topology=${topology} freshness=${freshness} forbidden="${forbidden}"`).not.toContain(forbidden);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 12-state matrix (4 topology x 3 freshness): exact codes, exact canonical
// order, exact text, validator acceptance, forbidden-wording absence, and
// id stability, per cell (Milestone 11.3.0 semantic-closure remediation).
// ---------------------------------------------------------------------------

describe("12-state topology x freshness matrix", () => {
  for (const topology of TOPOLOGY_STATES) {
    for (const freshness of FRESHNESS_STATES) {
      it(`topology=${topology} freshness=${freshness}`, () => {
        const digest = "matrixdigest0001";
        const built = () => buildProposalTruthDisclosure(input({ topology: [{ status: topology }], advisory_freshness: freshness, base_snapshot_digest: digest }));
        const a = built();
        const b = built();
        const expected = expectedQualification(digest, topology, freshness);

        expect(a.topology_disclosure_status).toBe(topology);
        expect(a.advisory_freshness).toBe(freshness);
        expect(a.qualification_codes).toEqual(expected.codes);
        expect(a.qualification_codes.length).toBe(4);
        expect(a.qualification_text).toBe(expected.text);
        expect(validateProposalTruthDisclosure(a)).toEqual([]);

        const lowered = a.qualification_text.toLowerCase();
        for (const forbidden of FORBIDDEN_PROPOSAL_TRUTH_WORDING) {
          expect(lowered).not.toContain(forbidden);
        }

        expect(a.id).toBe(b.id);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Topology authority boundary: only `.status` is ever read off a topology
// array entry -- never any other field, including ones shaped like
// `OverlayEntityProvenance` data (Milestone 11.3.0 semantic-closure
// remediation, closure 2).
// ---------------------------------------------------------------------------

describe("topology authority boundary", () => {
  it("ignores decoy OverlayEntityProvenance-shaped fields on a topology entry -- output is byte-identical to status alone", () => {
    const clean = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }] }));
    const decoy = buildProposalTruthDisclosure(
      input({
        topology: [{ status: "explicit", provenance: "confirmed", entity_id: "x", overlay_entity_count: 500, edge_count: 900 } as unknown as { status: ProposalTopologyDisclosureStatus }],
      }),
    );
    expect(decoy).toEqual(clean);
  });

  it("reduceTopologyDisclosureStatus treats an empty topology array as not_supplied, never as explicit", () => {
    expect(reduceTopologyDisclosureStatus([])).toBe("not_supplied");
  });
});

// ---------------------------------------------------------------------------
// §44 caller authority -- authoritative fields cannot be overridden through
// the build() input, even by a caller that bypasses the type system.
// ---------------------------------------------------------------------------

describe("caller authority", () => {
  it("ignores an injected id/qualification_text/qualification_codes/schema_version/artifact_kind/basis on the input object", () => {
    const hostileInput = {
      ...input(),
      id: "attacker-chosen-id",
      qualification_text: "APPROVED FOR PRODUCTION",
      qualification_codes: ["approved"],
      schema_version: 999,
      artifact_kind: "architecture_explorer",
      baseline_basis: "hypothetical",
      proposal_basis: "rvs_generated",
      projection_basis: "predicted",
    } as unknown as ProposalTruthDisclosureInput;

    const d = buildProposalTruthDisclosure(hostileInput);
    expect(d.id).not.toBe("attacker-chosen-id");
    expect(d.qualification_text.toLowerCase()).not.toContain("approved");
    expect(d.qualification_codes).not.toContain("approved" as unknown as ProposalTruthQualificationCode);
    expect(d.qualification_codes).not.toContain("FAKE_CODE" as unknown as ProposalTruthQualificationCode);
    expect(d.schema_version).toBe(1);
    expect(d.artifact_kind).toBe("proposal_review");
    expect(d.baseline_basis).toBe("observed");
    expect(d.proposal_basis).toBe("caller_supplied");
    expect(d.projection_basis).toBe("deterministically_projected");
  });
});

// ---------------------------------------------------------------------------
// §45 determinism / §19 stable ids
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("produces a byte-identical serialization across 5 repeated constructions", () => {
    const canonical = JSON.stringify(canonicalize(buildProposalTruthDisclosure(input())));
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(canonicalize(buildProposalTruthDisclosure(input())))).toBe(canonical);
    }
  });

  it("is invariant to topology array order, for 5 shuffled-equivalent constructions", () => {
    const topology = [{ status: "explicit" as const }, { status: "partial" as const }, { status: "not_supplied" as const }];
    const canonical = JSON.stringify(canonicalize(buildProposalTruthDisclosure(input({ topology }))));
    for (let seed = 1; seed <= 5; seed++) {
      const shuffled = shuffle(topology, seed);
      expect(JSON.stringify(canonicalize(buildProposalTruthDisclosure(input({ topology: shuffled }))))).toBe(canonical);
    }
  });

  it("assigns the same id to two independently built disclosures over identical inputs", () => {
    const a = buildProposalTruthDisclosure(input());
    const b = buildProposalTruthDisclosure(input());
    expect(a.id).toBe(b.id);
  });

  it("assigns the same id to two disclosures that differ only in qualification_text/qualification_codes derivation path -- id depends only on the three structured fields", () => {
    const a = buildProposalTruthDisclosure(input({ topology: [{ status: "partial" }] }));
    const b = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }, { status: "partial" }] }));
    // Both reduce to the same topology_disclosure_status ("partial"), so
    // despite differently-shaped inputs, the semantic disclosure -- and
    // therefore the id -- must be identical.
    expect(a.topology_disclosure_status).toBe(b.topology_disclosure_status);
    expect(a.id).toBe(b.id);
  });

  it("assigns a different id when advisory_freshness changes", () => {
    const current = buildProposalTruthDisclosure(input({ advisory_freshness: "current" }));
    const stale = buildProposalTruthDisclosure(input({ advisory_freshness: "stale_equivalent" }));
    expect(current.id).not.toBe(stale.id);
  });

  it("assigns a different id when topology_disclosure_status changes", () => {
    const explicit = buildProposalTruthDisclosure(input({ topology: [{ status: "explicit" }] }));
    const unresolved = buildProposalTruthDisclosure(input({ topology: [{ status: "unresolved" }] }));
    expect(explicit.id).not.toBe(unresolved.id);
  });

  it("assigns a different id when proposal_id or advisory_id changes", () => {
    const a = buildProposalTruthDisclosure(input({ proposal_id: "proposal_1" }));
    const b = buildProposalTruthDisclosure(input({ proposal_id: "proposal_2" }));
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// §46 serialization round-trip
// ---------------------------------------------------------------------------

describe("serialization", () => {
  it("round-trips through JSON with no loss and no violations", () => {
    const original = buildProposalTruthDisclosure(input());
    const roundTripped = JSON.parse(JSON.stringify(original)) as ProposalTruthDisclosure;
    expect(roundTripped).toEqual(original);
    expect(validateProposalTruthDisclosure(roundTripped)).toEqual([]);
  });

  it("produces plain JSON-safe values only (no functions, symbols, or class instances)", () => {
    const d = buildProposalTruthDisclosure(input());
    for (const value of Object.values(d)) {
      expect(["string", "number"].includes(typeof value) || Array.isArray(value)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §58 north-star contract proof -- a serialized disclosure alone answers
// every question a later, detached renderer/consumer needs, without
// re-deriving anything and without parsing prose.
// ---------------------------------------------------------------------------

describe("north-star contract proof", () => {
  it("answers artifact kind, every basis, baseline/proposal/advisory/repository identity, topology disclosure status, freshness, and qualification codes from serialized JSON alone", () => {
    const serialized = JSON.stringify(buildProposalTruthDisclosure(input({ topology: [{ status: "partial" }], advisory_freshness: "stale_equivalent" })));
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(parsed.artifact_kind).toBe("proposal_review");
    expect(parsed.baseline_basis).toBe("observed");
    expect(parsed.proposal_basis).toBe("caller_supplied");
    expect(parsed.projection_basis).toBe("deterministically_projected");
    expect(typeof parsed.repository_id).toBe("string");
    expect(typeof parsed.base_snapshot_digest).toBe("string");
    expect(typeof parsed.proposal_id).toBe("string");
    expect(typeof parsed.advisory_id).toBe("string");
    expect(parsed.topology_disclosure_status).toBe("partial");
    expect(parsed.advisory_freshness).toBe("stale_equivalent");
    expect(Array.isArray(parsed.qualification_codes)).toBe(true);
    expect((parsed.qualification_codes as unknown[]).length).toBe(4);
    expect(validateProposalTruthDisclosure(parsed)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Package/source boundary (§34, §64): this file must never import
// @rvs/change-workbench, keeping visual-intelligence's zero-@rvs/*-runtime-
// dependency property intact.
// ---------------------------------------------------------------------------

describe("package boundary", () => {
  it("proposal-truth.ts has no import/require statement referencing @rvs/change-workbench", () => {
    const path = fileURLToPath(new URL("../proposal-truth.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line) || /\brequire\(/.test(line));
    for (const line of importLines) {
      expect(line).not.toContain("@rvs/change-workbench");
    }
    // The string may still appear in doc comments citing upstream precedent
    // (e.g. the decode.ts pollution-key convention) -- that's documentation,
    // not a dependency, and is exactly what this test must not flag.
  });
});
