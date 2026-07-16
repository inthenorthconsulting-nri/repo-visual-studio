export type EvidenceConfidence = "confirmed" | "inferred" | "uncertain";

export interface EvidenceSource {
  path: string;
  lines?: string;
}

export interface EvidenceClaim {
  claim_id: string;
  claim: string;
  sources: EvidenceSource[];
  confidence: EvidenceConfidence;
}

export interface EvidenceManifest {
  generated_at: string;
  git_commit: string;
  claims: EvidenceClaim[];
}

export interface GeneratorStamp {
  generator_version: string;
  git_commit: string;
  design_system: string;
  content_spec_hash: string;
  generated_at: string;
}

export const GENERATOR_VERSION = "0.1.0";
