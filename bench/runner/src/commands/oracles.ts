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

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { gradeApp } from "../graders/grade.ts";
import { loadTask, OracleExpectation, taskIds } from "../tasks.ts";

/**
 * Grades every oracle (a known solution overlaid on the task's app) and compares with its
 * `expect.yaml`: proof that the graders tell good from bad before any agent is graded by them.
 */
export async function oracles(filter: readonly string[]): Promise<boolean> {
  let ok = true;
  for (const id of taskIds().filter((task) => filter.length === 0 || filter.includes(task))) {
    const task = loadTask(id);
    const oraclesDir = join(task.dir, "oracles");
    if (!existsSync(oraclesDir)) continue;
    for (const oracle of readdirSync(oraclesDir).sort()) {
      const expectPath = join(oraclesDir, oracle, "expect.yaml");
      if (!existsSync(expectPath)) {
        console.log(`? ${id}/${oracle}: no expect.yaml`);
        continue;
      }
      const expected = OracleExpectation.parse(parse(readFileSync(expectPath, "utf8")));
      const work = mkdtempSync(join(tmpdir(), "bench-oracle-"));
      try {
        cpSync(join(task.dir, "app"), work, { recursive: true });
        cpSync(join(oraclesDir, oracle), work, { recursive: true, filter: (source) => !source.endsWith("expect.yaml") });
        const grade = await gradeApp(task.spec, work);
        const problems: string[] = [];
        if (grade.works !== expected.works) problems.push(`works ${String(grade.works)} (${grade.failureClass}), expected ${String(expected.works)}`);
        for (const status of ["pass", "fail", "na"] as const) {
          for (const check of expected[status]) {
            const got = grade.checks[check];
            if (got?.status !== status) problems.push(`${check}: ${got?.status ?? "missing"} (${got?.evidence ?? ""}), expected ${status}`);
          }
        }
        if (problems.length === 0) console.log(`✓ ${id}/${oracle}`);
        else {
          ok = false;
          console.log(`✗ ${id}/${oracle}\n  ${problems.join("\n  ")}`);
          if (process.env["BENCH_DEBUG"] !== undefined) console.log(grade.log.join("\n"));
        }
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
  }
  return ok;
}
