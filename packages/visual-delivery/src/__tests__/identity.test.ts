import { describe, expect, it } from "vitest";
import {
  buildCandidateId,
  buildDeliveryFindingId,
  buildReceiptId,
  buildVerifiedArtifactId,
  canonicalJson,
  digestOf,
  digestOfBytes,
  targetKey,
} from "../ids.js";
import {
  DEFAULT_PROFILE_IDS,
  FAMILY_VALIDATORS,
  VALIDATOR_VERSIONS,
  VERIFICATION_PROFILES,
  findProfile,
  profileConfigDigest,
  profileIdentity,
  profileIds,
  requireProfile,
  type VerificationProfile,
} from "../validation-profile.js";
import { verificationDigest } from "../verification.js";
import { VISUAL_DELIVERY_SCHEMA_VERSION, type VisualDeliveryCandidate } from "../contracts.js";

// Identity in the delivery layer, which is two things that must never be one
// thing. Content identity answers "is this the artifact we already verified";
// run identity answers "which of these two runs happened later". A system that
// derived promotion order from content would refuse to re-promote after a
// revert; one that derived content identity from a run would re-verify bytes
// it had already measured. Both halves are asserted here, and so is the rule
// that ties them: nothing in this file's digests reads a clock.

function candidate(overrides: Partial<VisualDeliveryCandidate> = {}): VisualDeliveryCandidate {
  return {
    candidate_id: "vdc_0000000000000000000000",
    schema_version: VISUAL_DELIVERY_SCHEMA_VERSION,
    artifact_type: "architecture_explorer",
    source_path: ".rvs/cache/visual-delivery/runs/run-000001/architecture-explorer.html",
    target_path: ".rvs/out/architecture-explorer.html",
    visual_spec_id: "vspec_abc",
    source_digest: "a".repeat(64),
    artifact_digest: "b".repeat(64),
    validation_profile: "visual-interactive-v1",
    created_at: "2026-01-01T00:00:00.000Z",
    generation: 1,
    run_id: "run-000001",
    metadata: { producer: "rvs graph open", source_snapshot_ids: [], upstream_artifact_ids: [] },
    ...overrides,
  };
}

describe("canonical serialisation", () => {
  it("does not depend on the order keys were written in", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ outer: { z: [1, { y: 2, x: 3 }] } })).toBe(
      canonicalJson({ outer: { z: [1, { x: 3, y: 2 }] } }),
    );
  });

  it("keeps array order, because an array's order is part of what it says", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("drops undefined rather than serialising it, so an absent field and an explicit undefined agree", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("digests the exact bytes, and notices a one-byte difference", () => {
    expect(digestOfBytes(Buffer.from("<html>", "utf8"))).toBe(digestOfBytes(Buffer.from("<html>", "utf8")));
    expect(digestOfBytes(Buffer.from("<html>", "utf8"))).not.toBe(digestOfBytes(Buffer.from("<html> ", "utf8")));
  });
});

describe("candidate content identity", () => {
  const inputs = {
    artifact_type: "architecture_explorer",
    target_path: ".rvs/out/architecture-explorer.html",
    visual_spec_id: "vspec_abc",
    source_digest: "a".repeat(64),
    artifact_digest: "b".repeat(64),
    validation_profile: "visual-interactive-v1",
  };

  it("is stable whenever the inputs are stable", () => {
    const ids = new Set(Array.from({ length: 5 }, () => buildCandidateId(inputs)));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toMatch(/^vdc_[0-9a-f]{24}$/);
  });

  it("changes when any input that describes the artifact changes", () => {
    const base = buildCandidateId(inputs);
    expect(buildCandidateId({ ...inputs, artifact_digest: "c".repeat(64) })).not.toBe(base);
    expect(buildCandidateId({ ...inputs, source_digest: "c".repeat(64) })).not.toBe(base);
    expect(buildCandidateId({ ...inputs, visual_spec_id: "vspec_other" })).not.toBe(base);
    expect(buildCandidateId({ ...inputs, validation_profile: "visual-print-v1" })).not.toBe(base);
    expect(buildCandidateId({ ...inputs, artifact_type: "change_review" })).not.toBe(base);
    // The same bytes destined for two files are two candidates: promotion
    // replaces a named file, so where it is going is part of what it is.
    expect(buildCandidateId({ ...inputs, target_path: "artifacts/visuals/other.html" })).not.toBe(base);
  });

  it("takes nothing from the run: no clock, no generation, no staging directory", () => {
    // `buildCandidateId` has no parameter for any of them, and that is the
    // point being fixed here -- a regeneration on a different day, in a
    // different run directory, from the same inputs is the same candidate.
    expect(Object.keys(inputs).sort()).toEqual([
      "artifact_digest",
      "artifact_type",
      "source_digest",
      "target_path",
      "validation_profile",
      "visual_spec_id",
    ]);
  });
});

describe("derived identities", () => {
  it("names a verified artifact after the verification it completed", () => {
    const digest = digestOf({ some: "verification" });
    expect(buildVerifiedArtifactId(digest)).toBe(`vva_${digest.slice(0, 24)}`);
  });

  it("names a receipt after the candidate and the set of findings, not their order", () => {
    const shuffled = buildReceiptId("vdc_x", ["f3", "f1", "f2"]);
    expect(buildReceiptId("vdc_x", ["f1", "f2", "f3"])).toBe(shuffled);
    expect(buildReceiptId("vdc_y", ["f1", "f2", "f3"])).not.toBe(shuffled);
    expect(buildReceiptId("vdc_x", ["f1", "f2"])).not.toBe(shuffled);
  });

  it("gives the same defect on the same subject the same finding id across runs", () => {
    const id = buildDeliveryFindingId("rendered:contrast", "architecture-explorer@dark");
    expect(buildDeliveryFindingId("rendered:contrast", "architecture-explorer@dark")).toBe(id);
    expect(buildDeliveryFindingId("rendered:contrast", "architecture-explorer@light")).not.toBe(id);
    expect(buildDeliveryFindingId("rendered:overflow", "architecture-explorer@dark")).not.toBe(id);
    expect(id).toMatch(/^vdf_[0-9a-f]{16}$/);
  });

  it("keys per-target state by the path, with separators normalised", () => {
    expect(targetKey("artifacts/visuals/architecture.html")).toBe(targetKey("artifacts\\visuals\\architecture.html"));
    expect(targetKey("artifacts/visuals/architecture.html")).not.toBe(targetKey("artifacts/visuals/other.html"));
    expect(targetKey("a/b.html")).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("verification profiles", () => {
  it("versions its identity, and every published id says which version it is", () => {
    for (const profile of VERIFICATION_PROFILES) {
      expect(profile.id).toBe(`visual-${profile.name}-${profile.version}`);
      expect(profile.version).toMatch(/^v\d+$/);
    }
    expect(new Set(profileIds()).size).toBe(VERIFICATION_PROFILES.length);
  });

  it("names a browser requirement that follows from the families, rather than being asserted beside them", () => {
    for (const profile of VERIFICATION_PROFILES) {
      const derived = profile.families.some((family) => family === "layout" || family === "interaction");
      expect(profile.requires_browser, profile.id).toBe(derived);
    }
  });

  it("refuses an unknown profile by name and lists the ones that exist", () => {
    expect(() => requireProfile("visual-anything-goes-v9")).toThrow(/Unknown verification profile/);
    expect(() => requireProfile("visual-anything-goes-v9")).toThrow(/visual-standard-v1/);
    expect(findProfile("visual-standard-v1")?.name).toBe("standard");
  });

  it("resolves the ids the commands default to", () => {
    for (const id of Object.values(DEFAULT_PROFILE_IDS)) expect(findProfile(id), id).toBeDefined();
  });

  it("knows a validator version for every validator a family names", () => {
    for (const [family, validators] of Object.entries(FAMILY_VALIDATORS)) {
      for (const name of validators) expect(VALIDATOR_VERSIONS[name], `${family} -> ${name}`).toBeDefined();
    }
  });

  it("digests the configuration deterministically, and notices every threshold in it", () => {
    const standard = requireProfile("visual-standard-v1");
    const digests = new Set(Array.from({ length: 5 }, () => profileConfigDigest(standard)));
    expect(digests.size).toBe(1);

    const stricter: VerificationProfile = {
      ...standard,
      config: { ...standard.config, minimum_font_size_px: standard.config.minimum_font_size_px + 1 },
    };
    expect(profileConfigDigest(stricter)).not.toBe(profileConfigDigest(standard));

    const aaa: VerificationProfile = { ...standard, config: { ...standard.config, contrast_level: "AAA" } };
    expect(profileConfigDigest(aaa)).not.toBe(profileConfigDigest(standard));

    const lightOnly: VerificationProfile = { ...standard, config: { ...standard.config, color_schemes: ["light"] } };
    expect(profileConfigDigest(lightOnly)).not.toBe(profileConfigDigest(standard));

    const fewerFamilies: VerificationProfile = { ...standard, families: ["schema"] };
    expect(profileConfigDigest(fewerFamilies)).not.toBe(profileConfigDigest(standard));
  });

  it("publishes an identity that carries the config digest, so a record says what it was measured against", () => {
    const identity = profileIdentity(requireProfile("visual-interactive-v2"));
    expect(identity.id).toBe("visual-interactive-v2");
    expect(identity.version).toBe("v2");
    expect(identity.requires_browser).toBe(true);
    expect(identity.config_digest).toBe(profileConfigDigest(requireProfile("visual-interactive-v2")));
  });
});

describe("the verification digest", () => {
  const profile = requireProfile("visual-standard-v1");

  it("is the same on five identical runs", () => {
    const digests = new Set(Array.from({ length: 5 }, () => verificationDigest(candidate(), profile)));
    expect(digests.size).toBe(1);
  });

  it("carries no clock and no run identity, so two machines verifying the same bytes agree", () => {
    const monday = candidate({ created_at: "2026-01-01T00:00:00.000Z", generation: 1, run_id: "run-000001" });
    const friday = candidate({ created_at: "2026-06-30T23:59:59.999Z", generation: 412, run_id: "run-000412" });
    expect(verificationDigest(friday, profile)).toBe(verificationDigest(monday, profile));
  });

  it("changes when the artifact, its source, its destination or the rules change", () => {
    const base = verificationDigest(candidate(), profile);
    expect(verificationDigest(candidate({ artifact_digest: "c".repeat(64) }), profile)).not.toBe(base);
    expect(verificationDigest(candidate({ source_digest: "c".repeat(64) }), profile)).not.toBe(base);
    expect(verificationDigest(candidate({ visual_spec_id: "vspec_other" }), profile)).not.toBe(base);
    expect(verificationDigest(candidate({ target_path: "artifacts/visuals/other.html" }), profile)).not.toBe(base);
    expect(verificationDigest(candidate({ artifact_type: "change_review" }), profile)).not.toBe(base);
    expect(verificationDigest(candidate(), requireProfile("visual-print-v1"))).not.toBe(base);

    // The same profile id with a lowered threshold is not the same rules, and
    // the digest is what makes that visible -- see `verificationIsStale`.
    const loosened: VerificationProfile = { ...profile, config: { ...profile.config, minimum_font_size_px: 8 } };
    expect(verificationDigest(candidate(), loosened)).not.toBe(base);
  });
});
