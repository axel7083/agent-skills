/**
 * The bench server's client, generated from the document the server emits
 * (bench/server/openapi/openapi.json, `pnpm --filter @podman-desktop/agent-skills-bench-server gen`):
 * every operation, and every named schema (`Trial`, `Results`… with their zod validators), so the
 * runner and the report depend on the API alone. The generator doesn't write for
 * exactOptionalPropertyTypes: the sources compile to dist/ with their own options
 * (tsconfig.build.json), and consumers read the declarations.
 */

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
  output: { path: "./src", importFileExtension: ".ts" },
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", { name: "zod", requests: true, responses: true }, { name: "@hey-api/sdk", validator: true }],
});
