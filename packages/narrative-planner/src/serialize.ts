import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { NarrativeBrief } from "./brief.js";

export function serializeBrief(brief: NarrativeBrief): string {
  return stringifyYaml(brief, { indent: 2 });
}

export function parseBrief(raw: string): NarrativeBrief {
  return parseYaml(raw) as NarrativeBrief;
}
