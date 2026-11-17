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

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeAdapter, type NestNodeApplication } from "@nestjs/platform-node";
import { Test } from "@nestjs/testing";
import { configure } from "../../src/app.ts";
import { AppModule } from "../../src/app.module.ts";
import { OIDC_KEYS } from "../../src/auth/oidc-verifier.ts";
import { BIFROST_ADMIN_URL } from "./bifrost.ts";
import { ACTOR_ID, AUDIENCE, OWNER_ID, REPOSITORY, REPOSITORY_ID, type TestIssuer } from "./oidc.ts";

export const MODELS = ["gpt-oss-120b", "glm-4.6"];

/** The whole server against a test database, a fake Bifrost and a test OIDC issuer. */
export async function startApp(databaseUrl: string, issuer: TestIssuer, env: Record<string, string> = {}): Promise<NestNodeApplication> {
  const dir = mkdtempSync(join(tmpdir(), "bench-server-"));
  const prices = join(dir, "prices.json");
  writeFileSync(prices, JSON.stringify(Object.fromEntries(MODELS.map((model) => [model, { input: 2e-7, output: 8e-7 }]))));
  Object.assign(process.env, {
    NODE_ENV: "test",
    LOG_LEVEL: "warn",
    PUBLIC_URL: AUDIENCE,
    DATABASE_URL: databaseUrl,
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_REPOSITORY_ID: String(REPOSITORY_ID),
    GITHUB_OWNER_ID: String(OWNER_ID),
    ALLOWED_ACTOR_IDS: String(ACTOR_ID),
    BIFROST_ADMIN_URL,
    BIFROST_ADMIN_USERNAME: "admin",
    BIFROST_ADMIN_PASSWORD: "admin-password-for-tests",
    BIFROST_PUBLIC_URL: "https://llm.bench.test",
    PRICES_FILE: prices,
    MAX_RUN_USD: "10",
    DAILY_USD: "20",
    USAGE_LAG_MS: "0",
    ...env,
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OIDC_KEYS)
    .useValue(issuer.keys)
    .compile();
  const app = module.createNestApplication<NestNodeApplication>(new NodeAdapter(), { logger: ["error"] });
  configure(app);
  await app.init();
  return app;
}
