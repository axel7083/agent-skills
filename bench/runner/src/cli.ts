#!/usr/bin/env node
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

import { parseArgs } from "node:util";
import { agent } from "./commands/agent.ts";
import { complete } from "./commands/complete.ts";
import { grade } from "./commands/grade.ts";
import { oracles } from "./commands/oracles.ts";
import { plan } from "./commands/plan.ts";

const USAGE = `usage: bench-runner <command> [options]
  plan      --server URL --skill NAME --cells JSON --trials N --max-usd USD
  agent     --server URL --run ID --skill NAME --shard JSON --trials N --harbor PATH --out DIR
  grade     --skill NAME --shard JSON --attempt N --in DIR --out FILE
  complete  --server URL --run ID --in DIR
  oracles   [task…]`;

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    server: { type: "string" },
    run: { type: "string" },
    skill: { type: "string" },
    cells: { type: "string" },
    shard: { type: "string" },
    trials: { type: "string" },
    attempt: { type: "string" },
    "max-usd": { type: "string" },
    harbor: { type: "string", default: "harbor" },
    in: { type: "string" },
    out: { type: "string" },
  },
});

function required(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== "string" || value === "") throw new Error(`--${name} is required\n${USAGE}`);
  return value;
}

switch (command) {
  case "plan":
    await plan({ server: required("server"), skill: required("skill"), cells: required("cells"), trials: Number(required("trials")), maxUsd: Number(required("max-usd")) });
    break;
  case "agent":
    await agent({
      server: required("server"),
      runId: required("run"),
      skill: required("skill"),
      shard: required("shard"),
      trials: Number(required("trials")),
      harbor: required("harbor"),
      out: required("out"),
    });
    break;
  case "grade":
    await grade({ skill: required("skill"), shard: required("shard"), attempt: Number(required("attempt")), input: required("in"), out: required("out") });
    break;
  case "complete":
    await complete({ server: required("server"), runId: required("run"), input: required("in") });
    break;
  case "oracles":
    process.exitCode = (await oracles(positionals)) ? 0 : 1;
    break;
  case undefined:
  default:
    console.error(USAGE);
    process.exitCode = 2;
}
