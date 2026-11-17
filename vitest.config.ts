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

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // SWC emits decorator metadata, which Nest's dependency injection reads at runtime.
  plugins: [swc.vite({ jsc: { target: "es2023" }, module: { type: "es6" } })],
  // Workspace packages resolve to their TypeScript sources in tests, no build needed.
  resolve: { conditions: ["@podman-desktop/agent-skills-source"] },
  ssr: { resolve: { conditions: ["@podman-desktop/agent-skills-source"] } },
  test: {
    projects: [
      { extends: true, test: { name: "runner", include: ["bench/runner/test/**/*.test.ts"] } },
      { extends: true, test: { name: "server", include: ["bench/server/test/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "server-integration",
          include: ["bench/server/test/integration/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["bench/*/src/**"],
    },
  },
});
