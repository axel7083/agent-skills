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

import { defineConfig } from "@hey-api/openapi-ts";

/**
 * The bench server's client, generated from the document the server emits
 * (bench/server/openapi/openapi.json, `pnpm --filter @podman-desktop/agent-skills-bench-server gen`):
 * the workflow's endpoints only, requests and responses validated with the generated zod schemas.
 * The generator doesn't write for exactOptionalPropertyTypes: the sources compile to dist/ with
 * their own options (tsconfig.build.json), and consumers read the declarations.
 */
export default defineConfig({
  input: "../server/openapi/openapi.json",
  parser: {
    filters: {
      operations: {
        include: ["POST /v1/runs", "POST /v1/runs/{run}/shards/{shard}/key", "DELETE /v1/runs/{run}/shards/{shard}/key", "POST /v1/runs/{run}/trials", "POST /v1/runs/{run}/complete"],
      },
    },
  },
  output: { path: "./src", importFileExtension: ".ts" },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", { name: "zod", requests: true, responses: true }, { name: "@hey-api/sdk", validator: true }],
});
