/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

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
