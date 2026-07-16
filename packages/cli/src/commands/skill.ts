import { existsSync } from "node:fs";
import type { Logger } from "@rvs/core";
import { SKILLS_ROOT } from "../paths.js";

export function runSkillPath(logger: Logger): void {
  if (!existsSync(SKILLS_ROOT)) {
    throw new Error(`Agent skill NOT found (expected ${SKILLS_ROOT})`);
  }
  logger.info(SKILLS_ROOT);
}
