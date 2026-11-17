/**
 * Emits the JSON Schema files the raw-data API publishes, so non-TypeScript consumers never guess
 * a shape. CI fails on drift.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { EvalSpec, PublishedTrial, Results, RunDetail, RunSummary, Trial } from "../src/index.ts";

const outDir = join(import.meta.dirname, "..", "schemas");

const schemas: Readonly<Record<string, z.ZodType>> = {
  trial: Trial,
  "published-trial": PublishedTrial,
  results: Results,
  eval: EvalSpec,
  run: RunDetail,
  "run-summary": RunSummary,
};

await mkdir(outDir, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  await writeFile(join(outDir, `${name}.schema.json`), `${JSON.stringify(jsonSchema, null, 2)}\n`);
}
