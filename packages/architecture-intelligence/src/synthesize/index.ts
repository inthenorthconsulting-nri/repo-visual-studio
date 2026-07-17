import type { RepositoryModel } from "@rvs/repository-model";
import type { WorkflowGraph } from "@rvs/workflow-graph";
import type { TerraformTopology } from "@rvs/terraform-graph";
import { collectStatements, summarizeConfidence } from "../inference.js";
import type { ArchitectureIntelligence } from "../types.js";
import { buildActors, buildExternalSystems } from "./actors-external-systems.js";
import { buildComponentsFromRepository, buildComponentsFromTerraform, buildComponentsFromWorkflowFamilies } from "./components.js";
import { buildBoundaries, buildFlows } from "./flows-boundaries.js";
import { buildSystemIdentity, buildPurposeModel } from "./identity-purpose.js";
import { buildOperatingModel } from "./operating-model.js";
import { buildDependencies, buildOutcomes, buildRisks } from "./outcomes-risks-dependencies.js";
import { buildQuestions } from "./questions.js";
import { buildCapabilityDomains, buildResponsibilitiesFromTerraform, buildResponsibilitiesFromWorkflowFamilies } from "./responsibilities-capabilities.js";
import { buildWorkflowFamilies } from "./workflow-families.js";

export interface SynthesizeArchitectureIntelligenceInput {
  model: RepositoryModel;
  workflowGraphs: WorkflowGraph[];
  terraformTopologies: TerraformTopology[];
  gitCommit: string;
  generatedAt: string;
}

/**
 * Deterministically synthesizes an ArchitectureIntelligence model from
 * already-parsed evidence (RepositoryModel, WorkflowGraph[], TerraformTopology[]).
 * Never calls a model; every statement carries an explicit inference class
 * and a real EvidenceReference (or none, when unresolved).
 */
export function synthesizeArchitectureIntelligence(input: SynthesizeArchitectureIntelligenceInput): ArchitectureIntelligence {
  const { model, workflowGraphs, terraformTopologies } = input;

  const identity = buildSystemIdentity(model);
  const purpose = buildPurposeModel(model);

  const workflowFamilies = buildWorkflowFamilies(workflowGraphs);
  const workflowFamilyComponents = buildComponentsFromWorkflowFamilies(workflowFamilies);
  const terraformComponents = buildComponentsFromTerraform(terraformTopologies);
  const repositoryComponents = buildComponentsFromRepository(model);
  const components = [...repositoryComponents, ...terraformComponents, ...workflowFamilyComponents];

  const workflowComponentsByGraphId = new Map<string, (typeof workflowFamilyComponents)[number]>();
  for (const component of workflowFamilyComponents) {
    for (const graphId of component.implementation.workflowGraphIds) {
      workflowComponentsByGraphId.set(graphId, component);
    }
  }
  const workflowComponentIdByGraphId = new Map<string, string>();
  for (const [graphId, component] of workflowComponentsByGraphId) workflowComponentIdByGraphId.set(graphId, component.id);

  const actors = buildActors(workflowGraphs);
  const actorsByLabel = new Map(actors.map((a) => [a.label.sourceLabel, a]));
  const externalSystems = buildExternalSystems(terraformTopologies);
  const externalSystemsByLabel = new Map(externalSystems.map((e) => [e.label.sourceLabel, e]));

  const flows = buildFlows({
    graphs: workflowGraphs,
    workflowComponentsByGraphId,
    actorsByLabel,
    terraformComponents,
    topologies: terraformTopologies,
    externalSystemsByLabel,
  });
  const boundaries = buildBoundaries(workflowGraphs, workflowComponentIdByGraphId);

  const workflowResponsibilities = buildResponsibilitiesFromWorkflowFamilies(workflowFamilies);
  const terraformResponsibilities = buildResponsibilitiesFromTerraform(terraformTopologies);
  const responsibilities = [...workflowResponsibilities, ...terraformResponsibilities];
  const capabilityDomains = buildCapabilityDomains(workflowFamilies, workflowResponsibilities, terraformResponsibilities, workflowFamilyComponents, terraformComponents);

  const operatingModel = buildOperatingModel(workflowGraphs, terraformTopologies, boundaries, workflowFamilies);
  const outcomes = buildOutcomes(capabilityDomains, operatingModel);
  const risks = buildRisks(workflowGraphs, terraformTopologies);
  const dependencies = buildDependencies(model);

  const withoutQuestions: Omit<ArchitectureIntelligence, "questions" | "metadata"> = {
    version: 1,
    identity,
    purpose,
    responsibilities,
    capabilityDomains,
    components,
    actors,
    externalSystems,
    flows,
    boundaries,
    operatingModel,
    outcomes,
    risks,
    dependencies,
    workflowFamilies,
  };

  const questions = buildQuestions(withoutQuestions);
  const confidence = summarizeConfidence(collectStatements(withoutQuestions));

  return {
    ...withoutQuestions,
    questions,
    metadata: {
      generated_at: input.generatedAt,
      git_commit: input.gitCommit,
      schema_version: 1,
      source_repository_model_generated_at: model.generated_at,
      workflow_graph_count: workflowGraphs.length,
      terraform_topology_count: terraformTopologies.length,
      assist_used: false,
      confidence,
    },
  };
}
