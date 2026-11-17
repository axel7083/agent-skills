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

import type { NestNodeApplication } from "@nestjs/platform-node";
import { completeRun, createRun, mintKey, revokeKey, uploadTrials } from "@podman-desktop/agent-skills-bench-server-client";
import { createClient } from "@podman-desktop/agent-skills-bench-server-client/client";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp } from "../support/app.ts";
import { FakeBifrost } from "../support/bifrost.ts";
import { testIssuer, type TestIssuer } from "../support/oidc.ts";
import { startPostgres, stopPostgres } from "../support/postgres.ts";
import { runRequest, trialFor } from "./fixtures.ts";

let postgres: StartedPostgreSqlContainer;
let issuer: TestIssuer;
let bifrost: FakeBifrost;
let app: NestNodeApplication;
let baseUrl: string;

beforeAll(async () => {
  [postgres, issuer] = await Promise.all([startPostgres(), testIssuer()]);
  bifrost = new FakeBifrost();
  bifrost.server.listen({ onUnhandledFrame: "bypass" });
  app = await startApp(postgres.getConnectionUri(), issuer);
  await app.listen(0, "127.0.0.1");
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  bifrost.server.close();
  await stopPostgres(postgres);
});

/** The client the runner uses, generated from the server's OpenAPI document, for one stage's job. */
function clientFor(stage: "plan" | "agent" | "upload") {
  return createClient({ baseUrl, auth: () => issuer.token({ environment: `bench-${stage}`, run_id: "5000" }), throwOnError: true });
}

describe("the generated client", () => {
  it("drives a run through the workflow's endpoints, validating both ways", async () => {
    const { data: created } = await createRun({ client: clientFor("plan"), body: runRequest, throwOnError: true });
    expect(created.shards).toHaveLength(4);
    for (const shard of created.shards) {
      const { data: key } = await mintKey({ client: clientFor("agent"), path: { run: created.runId, shard: shard.id }, throwOnError: true });
      expect(key.limitUsd).toBe(1);
      await revokeKey({ client: clientFor("agent"), path: { run: created.runId, shard: shard.id }, throwOnError: true });
      await uploadTrials({
        client: clientFor("upload"),
        path: { run: created.runId },
        body: { shard: shard.id, attempt: 1, artifactId: 9, trials: [0, 1].map((trial) => trialFor(shard, trial, shard.arm === "with")) },
        throwOnError: true,
      });
    }
    const { data: completion } = await completeRun({ client: clientFor("upload"), path: { run: created.runId }, throwOnError: true });
    // 2 tasks × 2 trials: a Δ, but too little data for a verdict.
    expect(completion.summaryMarkdown).toContain("Not enough data");
  });

  it("refuses a request that doesn't match the document before sending it", async () => {
    await expect(createRun({ client: clientFor("plan"), body: { ...runRequest, trials: 0 }, throwOnError: true })).rejects.toThrow();
  });

  it("surfaces the server's refusals", async () => {
    await expect(mintKey({ client: clientFor("upload"), path: { run: "00000000-0000-4000-8000-000000000000", shard: "s001" }, throwOnError: true })).rejects.toMatchObject({ error: "forbidden" });
  });
});
