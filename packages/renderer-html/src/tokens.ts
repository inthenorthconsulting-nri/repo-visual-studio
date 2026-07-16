import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DesignTokens {
  name: string;
  version: string;
  colors: {
    background: string;
    surface: string;
    text_primary: string;
    text_secondary: string;
    accent: string;
    border: string;
    success: string;
    warning: string;
  };
  typography: {
    display: string;
    heading: string;
    body: string;
    code: string;
  };
  spacing: {
    unit: number;
  };
  motion: {
    fast: number;
    normal: number;
    slow: number;
  };
}

export function loadDesignTokens(designSystemsRoot: string, id: string): DesignTokens {
  const path = resolve(designSystemsRoot, id, "tokens.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as DesignTokens;
}

export function tokensToCssVariables(tokens: DesignTokens): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(tokens.colors)) {
    lines.push(`  --rvs-color-${key.replace(/_/g, "-")}: ${value};`);
  }
  for (const [key, value] of Object.entries(tokens.typography)) {
    lines.push(`  --rvs-font-${key}: ${value};`);
  }
  lines.push(`  --rvs-spacing-unit: ${tokens.spacing.unit}px;`);
  for (const [key, value] of Object.entries(tokens.motion)) {
    lines.push(`  --rvs-motion-${key}: ${value}ms;`);
  }
  return lines.join("\n");
}
