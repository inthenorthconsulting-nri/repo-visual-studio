import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { VisualDocSchema } from "./schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../../../skills/repo-visual-studio/schemas/visualdoc.schema.json");

const jsonSchema = zodToJsonSchema(VisualDocSchema, "VisualDoc");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`);

console.log(`Wrote ${outPath}`);
