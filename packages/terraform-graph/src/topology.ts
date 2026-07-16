import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArchitectureEdge, ArchitectureNode, ArchitectureNodeStatus, EvidenceReference } from "@rvs/architecture-graph";
import { isLocalModuleSource, resolveLocalModuleSource, type TerraformDirectory } from "./discover.js";
import {
  classifyExpressionConfidence,
  expressionConfidenceToNodeStatus,
  extractInterpolations,
  extractReferenceAddresses,
  isDynamicValue,
  type TerraformExpressionConfidence,
} from "./expressions.js";
import { formatLines, locateBlock, locateLineWithin, parseTerraformFile, type ParsedTerraformFile } from "./hcl-bridge.js";
import * as ids from "./ids.js";
import { isSensitiveKeyName, REDACTED_PLACEHOLDER, redactAttributes, redactValueText } from "./redact.js";
import type {
  TerraformCloudProvider,
  TerraformEdgeType,
  TerraformModuleSourceKind,
  TerraformModuleSummary,
  TerraformOutputSummary,
  TerraformProviderSummary,
  TerraformResourceCategory,
  TerraformTopology,
  TerraformTopologyWarning,
  TerraformVariableSummary,
  TerraformWarningCode,
} from "./types.js";

// Top-level HCL block keys the declare pass understands. Anything else
// (e.g. `moved`, `import`, `check` — newer Terraform block kinds this
// builder does not model) is reported via TERRAFORM_UNSUPPORTED_BLOCK
// rather than silently dropped, so a repository using them is visibly
// incomplete in the topology rather than quietly wrong.
const KNOWN_TOP_LEVEL_BLOCK_KEYS = new Set(["terraform", "provider", "variable", "locals", "resource", "data", "output", "module"]);

// Node/edge construction happens in two full tree passes (declare, then
// link) rather than one. Terraform identifiers are directory-scoped, not
// declaration-order-scoped (a resource in main.tf can reference a variable
// declared later in variables.tf, or a module's output declared in a
// sibling file) — a single interleaved pass would make correctness depend
// on which file the fast-glob/sort order happened to visit first. The
// declare pass registers every node (and the address index entries used to
// resolve references) across the *entire* module tree; the link pass then
// creates every reference/dependency/output/input edge once the whole
// index is known to be complete.

function literalOrUnwrap(value: unknown): string | undefined {
  if (typeof value !== "string") return value == null ? undefined : String(value);
  if (!isDynamicValue(value)) return value;
  const interpolations = extractInterpolations(value);
  return interpolations[0] ?? value;
}

function unwrapExpr(raw: string): string {
  const m = /^\$\{([\s\S]*)\}$/.exec(raw);
  return m ? m[1] : raw;
}

const CONFIDENCE_RANK: Record<TerraformExpressionConfidence, number> = {
  confirmed: 0,
  "partially-resolved": 1,
  dynamic: 2,
  unsupported: 3,
};

function combineConfidence(...values: TerraformExpressionConfidence[]): TerraformExpressionConfidence {
  return values.reduce((worst, v) => (CONFIDENCE_RANK[v] > CONFIDENCE_RANK[worst] ? v : worst), "confirmed" as TerraformExpressionConfidence);
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactValueText(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKeyName(k) ? REDACTED_PLACEHOLDER : redactDeep(v);
    }
    return out;
  }
  return value;
}

const CLOUD_PROVIDER_RESOURCE_PREFIXES: Array<{ provider: TerraformCloudProvider; prefixes: string[] }> = [
  { provider: "aws", prefixes: ["aws_"] },
  { provider: "azure", prefixes: ["azurerm_", "azuread_"] },
  { provider: "google", prefixes: ["google_"] },
  { provider: "kubernetes", prefixes: ["kubernetes_"] },
  { provider: "databricks", prefixes: ["databricks_"] },
  { provider: "snowflake", prefixes: ["snowflake_"] },
  { provider: "github", prefixes: ["github_"] },
];

export function classifyCloudProvider(resourceType: string): TerraformCloudProvider {
  for (const { provider, prefixes } of CLOUD_PROVIDER_RESOURCE_PREFIXES) {
    if (prefixes.some((p) => resourceType.startsWith(p))) return provider;
  }
  return "generic";
}

const RESOURCE_CATEGORY_RULES: Array<{ category: TerraformResourceCategory; match: RegExp }> = [
  { category: "compute", match: /(instance|function|lambda|vm|compute|container|ecs|eks|gke|cluster|autoscal)/i },
  { category: "storage", match: /(bucket|storage|s3|blob|disk|volume|filesystem)/i },
  { category: "database", match: /(db_|database|rds|sql|dynamodb|cosmosdb|bigtable|firestore|redshift|elasticache)/i },
  { category: "network", match: /(vpc|subnet|network|route|gateway|lb|load_balancer|dns|firewall|nat)/i },
  { category: "identity", match: /(iam|role|policy|identity|service_account|user|group)/i },
  { category: "messaging", match: /(sqs|sns|topic|queue|pubsub|eventbridge|event_hub|kinesis)/i },
  { category: "observability", match: /(log|metric|alarm|monitor|dashboard|trace)/i },
  { category: "security", match: /(security_group|kms|secret|certificate|acl|waf)/i },
  { category: "analytics", match: /(athena|glue|analytics|warehouse|pipeline)/i },
  { category: "integration", match: /(api_gateway|apigateway|integration|webhook)/i },
];

export function classifyResourceCategory(resourceType: string): TerraformResourceCategory {
  for (const { category, match } of RESOURCE_CATEGORY_RULES) {
    if (match.test(resourceType)) return category;
  }
  return "unknown";
}

interface MergedFileSet {
  files: ParsedTerraformFile[];
}

interface DirEntry {
  relDir: string;
  modulePath: string;
  moduleNodeId: string;
  isRoot: boolean;
}

interface BuildContext {
  repoRoot: string;
  rootName: string;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  edgeIds: Set<string>;
  providers: TerraformProviderSummary[];
  modules: TerraformModuleSummary[];
  variables: TerraformVariableSummary[];
  outputs: TerraformOutputSummary[];
  warnings: TerraformTopologyWarning[];
  addressIndex: Map<string, string>; // "modulePath::kind::name" -> nodeId
  childModulePathOfModuleId: Map<string, string>; // moduleId -> child modulePath, local children only
  visitedDirs: Set<string>;
  terraformVersion?: string;
  directoryIndex: Map<string, TerraformDirectory>;
  parsedByDir: Map<string, MergedFileSet>;
  dirEntries: DirEntry[];
}

function pushWarning(
  ctx: BuildContext,
  code: TerraformWarningCode,
  severity: TerraformTopologyWarning["severity"],
  message: string,
  sourcePath: string,
  opts: { lines?: string; relatedId?: string; remediation?: string } = {},
): void {
  ctx.warnings.push({ code, severity, message, sourcePath, ...opts });
}

function addNode(ctx: BuildContext, node: ArchitectureNode, indexKey?: string): void {
  ctx.nodes.push(node);
  if (indexKey) ctx.addressIndex.set(indexKey, node.id);
}

function addEdge(
  ctx: BuildContext,
  type: TerraformEdgeType,
  source: string,
  target: string,
  evidence: EvidenceReference[],
  opts: { label?: string; status?: ArchitectureNodeStatus; metadata?: Record<string, unknown> } = {},
): void {
  const id = ids.edgeId(type, source, target);
  if (ctx.edgeIds.has(id)) return;
  ctx.edgeIds.add(id);
  ctx.edges.push({ id, type, source, target, evidence, ...opts });
}

function ensureUnknownNode(ctx: BuildContext, modulePath: string, address: string): string {
  const id = ids.unknownReferenceId(modulePath, address);
  if (!ctx.nodes.some((n) => n.id === id)) {
    addNode(ctx, { id, type: "unknown", label: address, status: "unresolved", evidence: [], metadata: { rawAddress: address } });
  }
  return id;
}

interface ResolvedAddress {
  nodeId: string;
  edgeType: TerraformEdgeType;
  resolved: boolean;
}

function resolveAddress(ctx: BuildContext, modulePath: string, rawAddress: string): ResolvedAddress {
  if (rawAddress.startsWith("var.")) {
    const name = rawAddress.slice(4).split(".")[0] ?? "";
    const id = ctx.addressIndex.get(`${modulePath}::variable::${name}`);
    if (id) return { nodeId: id, edgeType: "references", resolved: true };
  } else if (rawAddress.startsWith("local.")) {
    const name = rawAddress.slice(6).split(".")[0] ?? "";
    const id = ctx.addressIndex.get(`${modulePath}::local::${name}`);
    if (id) return { nodeId: id, edgeType: "references", resolved: true };
  } else if (rawAddress.startsWith("data.")) {
    const parts = rawAddress.split(".");
    const type = parts[1];
    const name = parts[2];
    if (type && name) {
      const id = ctx.addressIndex.get(`${modulePath}::data::${type}.${name}`);
      if (id) return { nodeId: id, edgeType: "reads-from", resolved: true };
    }
  } else if (rawAddress.startsWith("module.")) {
    const parts = rawAddress.split(".");
    const childName = parts[1];
    const moduleId = childName ? ctx.addressIndex.get(`${modulePath}::module::${childName}`) : undefined;
    if (moduleId) {
      const outputName = parts[2];
      if (outputName) {
        const childPath = ctx.childModulePathOfModuleId.get(moduleId);
        if (childPath !== undefined) {
          const outId = ctx.addressIndex.get(`${childPath}::output::${outputName}`);
          if (outId) return { nodeId: outId, edgeType: "exports", resolved: true };
        }
      }
      return { nodeId: moduleId, edgeType: "reads-from", resolved: true };
    }
  } else {
    const parts = rawAddress.split(".");
    if (parts.length >= 2) {
      const id = ctx.addressIndex.get(`${modulePath}::resource::${parts[0]}.${parts[1]}`);
      if (id) return { nodeId: id, edgeType: "references", resolved: true };
    }
  }
  return { nodeId: ensureUnknownNode(ctx, modulePath, rawAddress), edgeType: "unresolved-reference", resolved: false };
}

function linkReferences(ctx: BuildContext, modulePath: string, fromNodeId: string, value: unknown, evidence: EvidenceReference[], sourcePath: string): void {
  if (!isDynamicValue(value)) return;
  const addresses = new Set<string>();
  for (const body of extractInterpolations(value)) {
    for (const addr of extractReferenceAddresses(body)) addresses.add(addr);
  }
  for (const address of addresses) {
    const resolved = resolveAddress(ctx, modulePath, address);
    addEdge(ctx, resolved.edgeType, fromNodeId, resolved.nodeId, evidence);
    if (!resolved.resolved) {
      pushWarning(ctx, "TERRAFORM_UNRESOLVED_REFERENCE", "warning", `Reference "${address}" could not be statically resolved to a known node.`, sourcePath, {
        lines: evidence[0]?.lines,
        relatedId: fromNodeId,
        remediation: "Verify the referenced resource/module/variable/local exists and is spelled correctly.",
      });
    }
  }
}

async function parseDirectoryFiles(repoRoot: string, dir: TerraformDirectory): Promise<MergedFileSet> {
  const files: ParsedTerraformFile[] = [];
  for (const relPath of dir.files) {
    const text = await readFile(join(repoRoot, relPath), "utf8");
    try {
      files.push(await parseTerraformFile(relPath, text));
    } catch (err) {
      throw Object.assign(new Error(`${relPath}: ${(err as Error).message}`), { relPath });
    }
  }
  return { files };
}

function evidenceFor(file: ParsedTerraformFile, headerPattern: RegExp, occurrence: number): EvidenceReference[] {
  const loc = locateBlock(file.text, headerPattern, occurrence);
  return [{ path: file.path, lines: formatLines(loc) }];
}

// ---------- Pass A: declare every node across the whole module tree ----------

async function declareModule(ctx: BuildContext, relDir: string, modulePath: string, parentModuleNodeId: string | undefined): Promise<void> {
  if (ctx.visitedDirs.has(relDir)) {
    pushWarning(ctx, "TERRAFORM_UNSUPPORTED_BLOCK", "warning", `Module composition cycle detected at "${relDir}"; not re-parsed.`, relDir);
    return;
  }
  ctx.visitedDirs.add(relDir);

  const isRoot = modulePath === "";
  const moduleNodeId = isRoot ? ids.rootModuleId(ctx.rootName) : ids.childModuleId(modulePath);
  const moduleLabel = isRoot ? ctx.rootName : (modulePath.split(".").pop() ?? modulePath);

  addNode(ctx, {
    id: moduleNodeId,
    type: isRoot ? "root-module" : "child-module",
    label: moduleLabel,
    status: "confirmed",
    evidence: [{ path: relDir || "." }],
    metadata: { modulePath, localPath: relDir },
  });
  if (parentModuleNodeId) addEdge(ctx, "calls-module", parentModuleNodeId, moduleNodeId, [{ path: relDir || "." }]);
  ctx.dirEntries.push({ relDir, modulePath, moduleNodeId, isRoot });

  const dir = ctx.directoryIndex.get(relDir);
  if (!dir || dir.files.length === 0) return;

  let fileSet: MergedFileSet;
  try {
    fileSet = await parseDirectoryFiles(ctx.repoRoot, dir);
  } catch (err) {
    const relPath = (err as { relPath?: string }).relPath ?? relDir;
    pushWarning(ctx, "TERRAFORM_PARSE_ERROR", "error", (err as Error).message, relPath);
    return;
  }
  ctx.parsedByDir.set(relDir, fileSet);

  for (const file of fileSet.files) {
    const json = file.json;

    for (const key of Object.keys(json)) {
      if (!KNOWN_TOP_LEVEL_BLOCK_KEYS.has(key)) {
        pushWarning(
          ctx,
          "TERRAFORM_UNSUPPORTED_BLOCK",
          "warning",
          `Block type "${key}" is not recognized by the Terraform topology builder and was skipped.`,
          file.path,
        );
      }
    }

    const terraformBlocks = (json.terraform as Array<Record<string, unknown>> | undefined) ?? [];
    terraformBlocks.forEach((block, occurrence) => {
      if (typeof block.required_version === "string" && !ctx.terraformVersion) ctx.terraformVersion = block.required_version;
      const requiredProviders = (block.required_providers as Array<Record<string, unknown>> | undefined) ?? [];
      for (const rp of requiredProviders) {
        for (const [name, meta] of Object.entries(rp)) {
          if (ctx.providers.some((p) => p.modulePath === modulePath && p.name === name && !p.alias)) continue;
          const metaObj = (meta ?? {}) as Record<string, unknown>;
          const evidence = evidenceFor(file, /terraform\s*\{/, occurrence);
          const providerNodeId = ids.providerId(modulePath, name);
          const cloudProvider = classifyCloudProvider(`${name}_`);
          const summary: TerraformProviderSummary = {
            id: providerNodeId,
            name,
            cloudProvider,
            source: typeof metaObj.source === "string" ? metaObj.source : undefined,
            versionConstraint: typeof metaObj.version === "string" ? metaObj.version : undefined,
            modulePath,
            evidence,
          };
          ctx.providers.push(summary);
          addNode(
            ctx,
            {
              id: providerNodeId,
              type: "provider",
              label: name,
              status: "confirmed",
              evidence,
              metadata: { cloudProvider, source: summary.source, versionConstraint: summary.versionConstraint, declaredOnly: true },
            },
            `${modulePath}::provider::${name}`,
          );
          addEdge(ctx, "contains", moduleNodeId, providerNodeId, evidence);
        }
      }
      const backend = block.backend as Record<string, unknown[]> | undefined;
      if (backend) {
        const [backendType] = Object.keys(backend);
        if (backendType) {
          const attrsList = backend[backendType] as Array<Record<string, unknown>>;
          const attrs = attrsList[0] ?? {};
          const evidence = evidenceFor(file, /backend\s+"[^"]+"\s*\{/, 0);
          const backendNodeId = ids.backendId(backendType);
          const redacted = redactDeep(redactAttributes(attrs)) as Record<string, unknown>;
          addNode(
            ctx,
            { id: backendNodeId, type: "backend", label: backendType, status: "confirmed", evidence, metadata: { backendType, config: redacted } },
            `${modulePath}::backend::${backendType}`,
          );
          addEdge(ctx, "contains", moduleNodeId, backendNodeId, evidence);
        }
      }
    });

    const providerBlocks = (json.provider as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(providerBlocks)) {
      occurrences.forEach((body, occurrence) => {
        const aliasRaw = body.alias;
        const alias = aliasRaw != null ? literalOrUnwrap(aliasRaw) : undefined;
        const evidence = evidenceFor(file, new RegExp(`provider\\s+"${name}"\\s*\\{`), occurrence);
        const providerNodeId = ids.providerId(modulePath, name, alias);
        const cloudProvider = classifyCloudProvider(`${name}_`);
        const rest = { ...body };
        delete rest.alias;
        const configExpressions: Record<string, string> = {};
        const staticAttrs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rest)) {
          if (isDynamicValue(value)) configExpressions[key] = redactValueText(value);
          else staticAttrs[key] = value;
        }
        const redactedAttrs = redactDeep(redactAttributes(staticAttrs)) as Record<string, unknown>;
        const region = typeof redactedAttrs.region === "string" ? redactedAttrs.region : undefined;
        const accountOrProfile =
          typeof redactedAttrs.profile === "string" ? redactedAttrs.profile : typeof redactedAttrs.project === "string" ? redactedAttrs.project : undefined;

        // A `required_providers` entry (processed earlier, same pass) may
        // already have created a placeholder node/summary for this exact
        // (modulePath, name) with no alias. Replace it rather than pushing a
        // second node with the same deterministic ID, carrying its
        // source/versionConstraint forward since the explicit block never
        // repeats those.
        const existingNodeIdx = ctx.nodes.findIndex((n) => n.id === providerNodeId);
        if (existingNodeIdx !== -1) ctx.nodes.splice(existingNodeIdx, 1);
        const existingSummaryIdx = ctx.providers.findIndex((p) => p.id === providerNodeId);
        const existingSummary = existingSummaryIdx !== -1 ? ctx.providers[existingSummaryIdx] : undefined;
        if (existingSummaryIdx !== -1) ctx.providers.splice(existingSummaryIdx, 1);

        const summary: TerraformProviderSummary = {
          id: providerNodeId,
          name,
          alias,
          cloudProvider,
          region,
          accountOrProfile,
          source: existingSummary?.source,
          versionConstraint: existingSummary?.versionConstraint,
          configExpressions: Object.keys(configExpressions).length ? configExpressions : undefined,
          modulePath,
          evidence,
        };
        ctx.providers.push(summary);
        addNode(
          ctx,
          {
            id: providerNodeId,
            type: "provider",
            label: alias ? `${name}.${alias}` : name,
            status: Object.keys(configExpressions).length ? "partial" : "confirmed",
            evidence,
            metadata: { cloudProvider, region, accountOrProfile, alias, source: summary.source, versionConstraint: summary.versionConstraint, attributes: redactedAttrs },
          },
          `${modulePath}::provider::${alias ? `${name}.${alias}` : name}`,
        );
        addEdge(ctx, "contains", moduleNodeId, providerNodeId, evidence);
      });
    }

    const variableBlocks = (json.variable as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(variableBlocks)) {
      occurrences.forEach((body, occurrence) => {
        const evidence = evidenceFor(file, new RegExp(`variable\\s+"${name}"\\s*\\{`), occurrence);
        const sensitive = body.sensitive === true;
        const hasDefault = Object.prototype.hasOwnProperty.call(body, "default");
        const typeText = body.type != null ? literalOrUnwrap(body.type) : undefined;
        const variableNodeId = ids.variableId(modulePath, name);
        const summary: TerraformVariableSummary = {
          id: variableNodeId,
          name,
          modulePath,
          type: typeText,
          hasDefault,
          sensitive,
          description: typeof body.description === "string" ? body.description : undefined,
          hasValidation: Object.prototype.hasOwnProperty.call(body, "validation"),
          evidence,
        };
        ctx.variables.push(summary);
        if (sensitive && hasDefault) {
          pushWarning(ctx, "TERRAFORM_SENSITIVE_VALUE_REDACTED", "informational", `Default value of sensitive variable "${name}" was not captured.`, file.path, {
            lines: evidence[0]?.lines,
            relatedId: variableNodeId,
          });
        }
        addNode(
          ctx,
          {
            id: variableNodeId,
            type: "variable",
            label: name,
            status: "confirmed",
            evidence,
            metadata: {
              type: typeText,
              hasDefault,
              sensitive,
              default: sensitive ? undefined : hasDefault ? redactDeep(body.default) : undefined,
              description: summary.description,
              hasValidation: summary.hasValidation,
            },
          },
          `${modulePath}::variable::${name}`,
        );
        addEdge(ctx, "contains", moduleNodeId, variableNodeId, evidence);
      });
    }

    const localsBlocks = (json.locals as Array<Record<string, unknown>> | undefined) ?? [];
    localsBlocks.forEach((body, blockOccurrence) => {
      const blockLoc = locateBlock(file.text, /locals\s*\{/, blockOccurrence);
      for (const [name, value] of Object.entries(body)) {
        let evidence: EvidenceReference[];
        if (blockLoc) {
          const line = locateLineWithin(file.text, new RegExp(`^\\s*${name}\\s*=`), blockLoc.startLine, blockLoc.endLine);
          evidence = [{ path: file.path, lines: line ? String(line) : formatLines(blockLoc) }];
        } else {
          evidence = [{ path: file.path }];
        }
        const localNodeId = ids.localId(modulePath, name);
        const confidence = classifyExpressionConfidence(value);
        addNode(
          ctx,
          {
            id: localNodeId,
            type: "local",
            label: name,
            status: expressionConfidenceToNodeStatus(confidence),
            evidence,
            metadata: { rawExpression: isDynamicValue(value) ? redactValueText(value) : value },
          },
          `${modulePath}::local::${name}`,
        );
        addEdge(ctx, "contains", moduleNodeId, localNodeId, evidence);
      }
    });

    const resourceBlocks = (json.resource as Record<string, Record<string, Array<Record<string, unknown>>>> | undefined) ?? {};
    for (const [resourceType, byName] of Object.entries(resourceBlocks)) {
      for (const [name, occurrences] of Object.entries(byName)) {
        occurrences.forEach((body, occurrence) => {
          const address = `${resourceType}.${name}`;
          const indexKey = `${modulePath}::resource::${address}`;
          if (occurrence > 0 || ctx.addressIndex.has(indexKey)) {
            pushWarning(ctx, "TERRAFORM_RESOURCE_ADDRESS_COLLISION", "error", `Resource address "${address}" is declared more than once in module "${modulePath || "(root)"}".`, file.path);
            if (occurrence > 0) return;
          }
          const evidence = evidenceFor(file, new RegExp(`resource\\s+"${resourceType}"\\s+"${name}"\\s*\\{`), 0);
          const resourceNodeId = ids.resourceId(modulePath, resourceType, name);
          const { count, for_each: forEach, depends_on: _dependsOnRaw, provider: _providerRaw, lifecycle, ...rest } = body;
          const confidenceValues: TerraformExpressionConfidence[] = [];
          if (count !== undefined) confidenceValues.push(classifyExpressionConfidence(count));
          if (forEach !== undefined) confidenceValues.push(classifyExpressionConfidence(forEach));
          for (const value of Object.values(rest)) confidenceValues.push(classifyExpressionConfidence(value));
          const confidence = combineConfidence(...confidenceValues);
          const category = classifyResourceCategory(resourceType);
          const cloudProvider = classifyCloudProvider(resourceType);
          const attributes = redactDeep(redactAttributes(rest)) as Record<string, unknown>;

          addNode(
            ctx,
            {
              id: resourceNodeId,
              type: "resource",
              label: address,
              status: expressionConfidenceToNodeStatus(confidence),
              evidence,
              metadata: {
                resourceType,
                name,
                address,
                modulePath,
                resourceCategory: category,
                cloudProvider,
                hasCount: count !== undefined,
                hasForEach: forEach !== undefined,
                count: count !== undefined ? (isDynamicValue(count) ? redactValueText(count) : count) : undefined,
                forEach: forEach !== undefined ? (isDynamicValue(forEach) ? redactValueText(forEach) : forEach) : undefined,
                hasLifecycle: lifecycle !== undefined,
                attributes,
              },
            },
            indexKey,
          );
          addEdge(ctx, "contains", moduleNodeId, resourceNodeId, evidence);

          if (count !== undefined || forEach !== undefined) {
            const raw = count !== undefined ? count : forEach;
            if (classifyExpressionConfidence(raw) !== "confirmed") {
              pushWarning(
                ctx,
                "TERRAFORM_DYNAMIC_EXPRESSION",
                "informational",
                `Resource "${address}" uses ${count !== undefined ? "count" : "for_each"} with a dynamic expression; instances cannot be statically enumerated.`,
                file.path,
                { lines: evidence[0]?.lines, relatedId: resourceNodeId },
              );
            }
          }
        });
      }
    }

    const dataBlocks = (json.data as Record<string, Record<string, Array<Record<string, unknown>>>> | undefined) ?? {};
    for (const [dataType, byName] of Object.entries(dataBlocks)) {
      for (const [name, occurrences] of Object.entries(byName)) {
        occurrences.forEach((body, occurrence) => {
          const address = `${dataType}.${name}`;
          const indexKey = `${modulePath}::data::${address}`;
          if (occurrence > 0 || ctx.addressIndex.has(indexKey)) {
            pushWarning(ctx, "TERRAFORM_RESOURCE_ADDRESS_COLLISION", "error", `Data source address "data.${address}" is declared more than once in module "${modulePath || "(root)"}".`, file.path);
            if (occurrence > 0) return;
          }
          const evidence = evidenceFor(file, new RegExp(`data\\s+"${dataType}"\\s+"${name}"\\s*\\{`), 0);
          const dataNodeId = ids.dataSourceId(modulePath, dataType, name);
          const attributes = redactDeep(redactAttributes(body)) as Record<string, unknown>;
          const confidence = combineConfidence(...Object.values(body).map(classifyExpressionConfidence));
          addNode(
            ctx,
            {
              id: dataNodeId,
              type: "data-source",
              label: `data.${address}`,
              status: expressionConfidenceToNodeStatus(confidence),
              evidence,
              metadata: { dataType, name, address, modulePath, cloudProvider: classifyCloudProvider(dataType), attributes },
            },
            indexKey,
          );
          addEdge(ctx, "contains", moduleNodeId, dataNodeId, evidence);
        });
      }
    }

    const outputBlocks = (json.output as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(outputBlocks)) {
      occurrences.forEach((body, occurrence) => {
        const evidence = evidenceFor(file, new RegExp(`output\\s+"${name}"\\s*\\{`), occurrence);
        const sensitive = body.sensitive === true;
        const outputNodeId = ids.outputId(modulePath, name);
        const value = body.value;
        const referencedAddresses = !sensitive && isDynamicValue(value) ? extractInterpolations(value).flatMap(extractReferenceAddresses) : [];
        const summary: TerraformOutputSummary = {
          id: outputNodeId,
          name,
          modulePath,
          sensitive,
          description: typeof body.description === "string" ? body.description : undefined,
          referencedAddresses,
          evidence,
        };
        ctx.outputs.push(summary);
        addNode(
          ctx,
          {
            id: outputNodeId,
            type: "output",
            label: name,
            status: sensitive ? "partial" : "confirmed",
            evidence,
            metadata: { sensitive, description: summary.description, referencedAddresses },
          },
          `${modulePath}::output::${name}`,
        );
        addEdge(ctx, "contains", moduleNodeId, outputNodeId, evidence);
        if (sensitive) {
          pushWarning(ctx, "TERRAFORM_SENSITIVE_VALUE_REDACTED", "informational", `Output "${name}" is marked sensitive; its value expression was not captured.`, file.path, {
            lines: evidence[0]?.lines,
            relatedId: outputNodeId,
          });
        }
      });
    }

    const moduleBlocksRaw = (json.module as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(moduleBlocksRaw)) {
      for (let occurrence = 0; occurrence < occurrences.length; occurrence++) {
        const body = occurrences[occurrence];
        const evidence = evidenceFor(file, new RegExp(`module\\s+"${name}"\\s*\\{`), occurrence);
        const source = typeof body.source === "string" ? (literalOrUnwrap(body.source) ?? "") : "";
        const version = body.version != null ? literalOrUnwrap(body.version) : undefined;
        const { source: _s, version: _v, ...inputBody } = body;
        const inputs: Record<string, string> = {};
        for (const [k, v] of Object.entries(inputBody)) inputs[k] = isDynamicValue(v) ? redactValueText(v) : JSON.stringify(v);

        let sourceKind: TerraformModuleSourceKind;
        if (isLocalModuleSource(source)) sourceKind = "local";
        else if (/^git::|\.git(?:$|\/|\?)|^github\.com\//.test(source)) sourceKind = "git";
        else if (/^[^./]+\/[^./]+\/[^./]+$/.test(source)) sourceKind = "registry";
        else sourceKind = "other";

        const childModulePath = modulePath ? `${modulePath}.${name}` : name;

        if (sourceKind === "local") {
          const resolvedDir = resolveLocalModuleSource(ctx.repoRoot, relDir, source);
          if (ctx.directoryIndex.has(resolvedDir)) {
            const summary: TerraformModuleSummary = {
              id: ids.childModuleId(childModulePath),
              name,
              modulePath: childModulePath,
              kind: "child",
              source,
              sourceKind,
              version,
              localPath: resolvedDir,
              inputs,
              evidence,
            };
            ctx.modules.push(summary);
            ctx.addressIndex.set(`${modulePath}::module::${name}`, summary.id);
            ctx.childModulePathOfModuleId.set(summary.id, childModulePath);
            await declareModule(ctx, resolvedDir, childModulePath, moduleNodeId);
            summary.outputNames = ctx.outputs.filter((o) => o.modulePath === childModulePath).map((o) => o.name);
          } else {
            pushWarning(ctx, "TERRAFORM_LOCAL_MODULE_NOT_FOUND", "warning", `Module "${name}" declares local source "${source}" but no Terraform files were found at "${resolvedDir}".`, file.path, {
              lines: evidence[0]?.lines,
              remediation: "Verify the module's relative path, or that it is checked into the repository.",
            });
            const externalId = ids.externalModuleId(childModulePath);
            ctx.modules.push({ id: externalId, name, modulePath: childModulePath, kind: "external", source, sourceKind, version, inputs, evidence });
            addNode(ctx, { id: externalId, type: "external-module", label: name, status: "unresolved", evidence, metadata: { source, sourceKind, resolutionFailed: true } });
            ctx.addressIndex.set(`${modulePath}::module::${name}`, externalId);
            addEdge(ctx, "calls-module", moduleNodeId, externalId, evidence);
          }
        } else {
          const externalId = ids.externalModuleId(childModulePath);
          ctx.modules.push({ id: externalId, name, modulePath: childModulePath, kind: "external", source, sourceKind, version, inputs, evidence });
          addNode(ctx, { id: externalId, type: "external-module", label: name, status: "unresolved", evidence, metadata: { source, sourceKind } });
          ctx.addressIndex.set(`${modulePath}::module::${name}`, externalId);
          addEdge(ctx, "calls-module", moduleNodeId, externalId, evidence);
          pushWarning(ctx, "TERRAFORM_REMOTE_MODULE_OPAQUE", "informational", `Module "${name}" is sourced remotely ("${source}"); represented as an opaque external module.`, file.path, {
            lines: evidence[0]?.lines,
            relatedId: externalId,
          });
        }
      }
    }
  }
}

// ---------- Pass B: link every reference/dependency edge ----------

function linkModule(ctx: BuildContext, entry: DirEntry): void {
  const fileSet = ctx.parsedByDir.get(entry.relDir);
  if (!fileSet) return;
  const { modulePath } = entry;

  for (const file of fileSet.files) {
    const json = file.json;

    const localsBlocks = (json.locals as Array<Record<string, unknown>> | undefined) ?? [];
    localsBlocks.forEach((body, blockOccurrence) => {
      const blockLoc = locateBlock(file.text, /locals\s*\{/, blockOccurrence);
      for (const [name, value] of Object.entries(body)) {
        const localNodeId = ctx.addressIndex.get(`${modulePath}::local::${name}`);
        if (!localNodeId) continue;
        let evidence: EvidenceReference[];
        if (blockLoc) {
          const line = locateLineWithin(file.text, new RegExp(`^\\s*${name}\\s*=`), blockLoc.startLine, blockLoc.endLine);
          evidence = [{ path: file.path, lines: line ? String(line) : formatLines(blockLoc) }];
        } else {
          evidence = [{ path: file.path }];
        }
        linkReferences(ctx, modulePath, localNodeId, value, evidence, file.path);
      }
    });

    const providerBlocks = (json.provider as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(providerBlocks)) {
      occurrences.forEach((body, occurrence) => {
        const aliasRaw = body.alias;
        const alias = aliasRaw != null ? literalOrUnwrap(aliasRaw) : undefined;
        const providerNodeId = ctx.addressIndex.get(`${modulePath}::provider::${alias ? `${name}.${alias}` : name}`);
        if (!providerNodeId) return;
        const evidence = evidenceFor(file, new RegExp(`provider\\s+"${name}"\\s*\\{`), occurrence);
        const { alias: _alias, ...rest } = body;
        for (const value of Object.values(rest)) linkReferences(ctx, modulePath, providerNodeId, value, evidence, file.path);
      });
    }

    const resourceBlocks = (json.resource as Record<string, Record<string, Array<Record<string, unknown>>>> | undefined) ?? {};
    for (const [resourceType, byName] of Object.entries(resourceBlocks)) {
      for (const [name, occurrences] of Object.entries(byName)) {
        const body = occurrences[0];
        if (!body) continue;
        const address = `${resourceType}.${name}`;
        const resourceNodeId = ctx.addressIndex.get(`${modulePath}::resource::${address}`);
        if (!resourceNodeId) continue;
        const evidence = evidenceFor(file, new RegExp(`resource\\s+"${resourceType}"\\s+"${name}"\\s*\\{`), 0);
        const { count: _count, for_each: _forEach, depends_on: dependsOnRaw, provider: providerRaw, lifecycle: _lifecycle, ...rest } = body;

        if (Array.isArray(dependsOnRaw)) {
          for (const entryValue of dependsOnRaw) {
            if (typeof entryValue !== "string") continue;
            const dependAddress = unwrapExpr(entryValue);
            const resolved = resolveAddress(ctx, modulePath, dependAddress);
            addEdge(ctx, "depends-on", resourceNodeId, resolved.nodeId, evidence);
            if (!resolved.resolved) {
              pushWarning(ctx, "TERRAFORM_UNKNOWN_DEPENDS_ON", "warning", `Resource "${address}" depends_on references unresolvable address "${dependAddress}".`, file.path, {
                lines: evidence[0]?.lines,
                relatedId: resourceNodeId,
              });
            }
          }
        }

        if (typeof providerRaw === "string") {
          const providerAddress = unwrapExpr(providerRaw);
          const [providerName] = providerAddress.split(".");
          const providerNodeId = ctx.addressIndex.get(`${modulePath}::provider::${providerAddress}`) ?? ctx.addressIndex.get(`${modulePath}::provider::${providerName}`);
          if (providerNodeId) {
            addEdge(ctx, "uses-provider", resourceNodeId, providerNodeId, evidence);
          } else {
            pushWarning(ctx, "TERRAFORM_PROVIDER_UNRESOLVED", "warning", `Resource "${address}" references provider "${providerAddress}" which has no matching provider block.`, file.path, {
              lines: evidence[0]?.lines,
              relatedId: resourceNodeId,
            });
          }
        } else {
          const defaultProviderId = ctx.addressIndex.get(`${modulePath}::provider::${resourceType.split("_")[0]}`);
          if (defaultProviderId) addEdge(ctx, "uses-provider", resourceNodeId, defaultProviderId, evidence);
        }

        for (const value of Object.values(rest)) linkReferences(ctx, modulePath, resourceNodeId, value, evidence, file.path);
      }
    }

    const dataBlocks = (json.data as Record<string, Record<string, Array<Record<string, unknown>>>> | undefined) ?? {};
    for (const [dataType, byName] of Object.entries(dataBlocks)) {
      for (const [name, occurrences] of Object.entries(byName)) {
        const body = occurrences[0];
        if (!body) continue;
        const address = `${dataType}.${name}`;
        const dataNodeId = ctx.addressIndex.get(`${modulePath}::data::${address}`);
        if (!dataNodeId) continue;
        const evidence = evidenceFor(file, new RegExp(`data\\s+"${dataType}"\\s+"${name}"\\s*\\{`), 0);
        for (const value of Object.values(body)) linkReferences(ctx, modulePath, dataNodeId, value, evidence, file.path);
      }
    }

    const outputBlocks = (json.output as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(outputBlocks)) {
      occurrences.forEach((body, occurrence) => {
        if (body.sensitive === true) return;
        const outputNodeId = ctx.addressIndex.get(`${modulePath}::output::${name}`);
        if (!outputNodeId) return;
        const evidence = evidenceFor(file, new RegExp(`output\\s+"${name}"\\s*\\{`), occurrence);
        const value = body.value;
        if (!isDynamicValue(value)) return;
        const addresses = new Set<string>();
        for (const b of extractInterpolations(value)) for (const a of extractReferenceAddresses(b)) addresses.add(a);
        for (const address of addresses) {
          const resolved = resolveAddress(ctx, modulePath, address);
          addEdge(ctx, "produces-output", resolved.nodeId, outputNodeId, evidence);
        }
      });
    }

    const moduleBlocksRaw = (json.module as Record<string, Array<Record<string, unknown>>> | undefined) ?? {};
    for (const [name, occurrences] of Object.entries(moduleBlocksRaw)) {
      occurrences.forEach((body, occurrence) => {
        const targetId = ctx.addressIndex.get(`${modulePath}::module::${name}`);
        if (!targetId) return;
        const evidence = evidenceFor(file, new RegExp(`module\\s+"${name}"\\s*\\{`), occurrence);
        const { source: _s, version: _v, ...inputBody } = body;
        for (const inputValue of Object.values(inputBody)) {
          if (!isDynamicValue(inputValue)) continue;
          for (const b of extractInterpolations(inputValue)) {
            for (const address of extractReferenceAddresses(b)) {
              const resolved = resolveAddress(ctx, modulePath, address);
              addEdge(ctx, "passes-input", resolved.nodeId, targetId, evidence);
            }
          }
        }
      });
    }
  }
}

export async function buildTerraformTopology(repoRoot: string, rootRelDir: string, rootName: string, allDirectories: TerraformDirectory[]): Promise<TerraformTopology> {
  const directoryIndex = new Map(allDirectories.map((d) => [d.relDir, d]));
  const ctx: BuildContext = {
    repoRoot,
    rootName,
    nodes: [],
    edges: [],
    edgeIds: new Set(),
    providers: [],
    modules: [],
    variables: [],
    outputs: [],
    warnings: [],
    addressIndex: new Map(),
    childModulePathOfModuleId: new Map(),
    visitedDirs: new Set(),
    directoryIndex,
    parsedByDir: new Map(),
    dirEntries: [],
  };

  await declareModule(ctx, rootRelDir, "", undefined);
  for (const entry of ctx.dirEntries) linkModule(ctx, entry);

  const hasDynamicExpressions = ctx.nodes.some((n) => n.status === "dynamic" || n.status === "partial");
  const hasExternalModules = ctx.modules.some((m) => m.kind === "external");

  return {
    id: ids.rootModuleId(rootName),
    name: rootName,
    rootModulePath: rootRelDir,
    terraformVersion: ctx.terraformVersion,
    providers: ctx.providers,
    modules: ctx.modules,
    nodes: ctx.nodes,
    edges: ctx.edges,
    variables: ctx.variables,
    outputs: ctx.outputs,
    warnings: ctx.warnings,
    evidence: [{ path: rootRelDir || "." }],
    metadata: {
      moduleCount: ctx.modules.filter((m) => m.kind !== "external").length + 1,
      resourceCount: ctx.nodes.filter((n) => n.type === "resource").length,
      dataSourceCount: ctx.nodes.filter((n) => n.type === "data-source").length,
      providerCount: ctx.providers.length,
      variableCount: ctx.variables.length,
      outputCount: ctx.outputs.length,
      hasDynamicExpressions,
      hasExternalModules,
    },
  };
}
