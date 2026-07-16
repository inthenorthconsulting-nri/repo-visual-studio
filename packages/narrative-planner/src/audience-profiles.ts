export type TechnicalDepth = "low" | "medium" | "high";

export interface AudienceSectionTemplate {
  id: string;
  purpose: string;
}

export interface AudienceProfile {
  id: "executive" | "architecture-review";
  audience: string;
  purpose: string;
  duration_minutes: number;
  technical_depth: TechnicalDepth;
  decision_required: boolean;
  sections: AudienceSectionTemplate[];
}

export const AUDIENCE_PROFILES: Record<AudienceProfile["id"], AudienceProfile> = {
  executive: {
    id: "executive",
    audience: "executive",
    purpose: "decision",
    duration_minutes: 10,
    technical_depth: "low",
    decision_required: true,
    sections: [
      { id: "context", purpose: "Explain what the project is and why it exists" },
      { id: "target_state", purpose: "Show the technology and delivery model in plain terms" },
      { id: "status", purpose: "Explain current progress and recent activity" },
      { id: "decision", purpose: "State the decision or approval being requested" },
    ],
  },
  "architecture-review": {
    id: "architecture-review",
    audience: "technical-leadership",
    purpose: "review",
    duration_minutes: 20,
    technical_depth: "high",
    decision_required: false,
    sections: [
      { id: "context", purpose: "Explain what the project is and why it exists" },
      { id: "architecture", purpose: "Show the technology stack and structural composition" },
      { id: "status", purpose: "Explain current progress, CI posture, and recent activity" },
    ],
  },
};

export function getAudienceProfile(id: string): AudienceProfile {
  const profile = AUDIENCE_PROFILES[id as AudienceProfile["id"]];
  if (!profile) {
    throw new Error(
      `Unknown audience profile "${id}". Available: ${Object.keys(AUDIENCE_PROFILES).join(", ")}`,
    );
  }
  return profile;
}
