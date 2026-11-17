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

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardSchemaValidationPipe } from "@nestjs/common";
import type { NestNodeApplication } from "@nestjs/platform-node";
import { SwaggerModule } from "@nestjs/swagger";
import { OPENAPI_PATH, openApiDocument } from "./openapi.ts";
import { ASSETS_PREFIX } from "./report/report.controller.ts";
import { DomainErrorFilter } from "./http/domain-error.filter.ts";

/** The report's bundle: bench/report/dist/assets, next to its package's src/ or dist/ entry. */
export function reportAssetsDir(): string {
  const entry = fileURLToPath(import.meta.resolve("@podman-desktop/agent-skills-bench-report"));
  return join(dirname(entry), "..", "dist", "assets");
}

/** Everything main.ts and the tests share. */
export function configure(app: NestNodeApplication): NestNodeApplication {
  app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }));
  app.useGlobalFilters(new DomainErrorFilter());
  // A shard's trials with their evidence stay well under this.
  app.useBodyParser("json", { limit: "1mb" });
  app.useStaticAssets(reportAssetsDir(), { prefix: ASSETS_PREFIX, maxAge: "1h", dotfiles: "deny", index: false });
  // The document only: no UI (its inline scripts would need a looser CSP).
  SwaggerModule.setup("api/docs", app, openApiDocument(app), { ui: false, raw: ["json"], jsonDocumentUrl: OPENAPI_PATH });
  return app;
}
