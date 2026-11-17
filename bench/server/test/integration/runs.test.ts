import type { NestNodeApplication } from "@nestjs/platform-node";
import { CompleteRunResponse, CreateRunResponse, MintedKey, PublishedTrial, Results, RunDetail } from "@podman-desktop/bench-contracts";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SweeperService } from "../../src/sweeper/sweeper.service.ts";
import { FakeBifrost } from "../support/bifrost.ts";
import { startApp } from "../support/app.ts";
import { testIssuer, type TestIssuer } from "../support/oidc.ts";
import { startPostgres } from "../support/postgres.ts";
import { runRequest, trialFor } from "./fixtures.ts";

let postgres: StartedPostgreSqlContainer;
let issuer: TestIssuer;
let bifrost: FakeBifrost;
let app: NestNodeApplication;
let githubRun = 2000;

beforeAll(async () => {
  [postgres, issuer] = await Promise.all([startPostgres(), testIssuer()]);
  bifrost = new FakeBifrost();
  // Only Bifrost is faked: testcontainers' calls to the Podman API go through.
  bifrost.server.listen({ onUnhandledFrame: "bypass" });
  app = await startApp(postgres.getConnectionUri(), issuer);
});

afterAll(async () => {
  await app.close();
  bifrost.server.close();
  await postgres.stop();
});

/** Each test is its own workflow run; the previous one is completed or abandoned first. */
beforeEach(async () => {
  githubRun++;
  await postgres.exec(["psql", "-U", "bench", "-d", "bench", "-c", "update runs set status = 'abandoned' where status = 'running'"]);
});

type Stage = "plan" | "agent" | "upload";

async function call(method: "GET" | "POST" | "DELETE", url: string, stage?: Stage, body?: unknown, claims: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (stage !== undefined) headers["authorization"] = `Bearer ${await issuer.token({ environment: `bench-${stage}`, run_id: String(githubRun), ...claims })}`;
  return app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
}

async function createRun(): Promise<CreateRunResponse> {
  const response = await call("POST", "/v1/runs", "plan", runRequest);
  expect(response.statusCode, response.body).toBe(201);
  return CreateRunResponse.parse(response.json());
}

describe("a benchmark run, end to end", () => {
  it("mints capped keys, takes graded trials, and publishes the results", async () => {
    const { runId, shards } = await createRun();
    expect(shards.map((shard) => `${shard.arm}/${shard.task}`)).toEqual(["without/task-a", "without/task-b", "with/task-a", "with/task-b"]);

    for (const shard of shards) {
      const minted = await call("POST", `/v1/runs/${runId}/shards/${shard.id}/key`, "agent");
      expect(minted.statusCode, minted.body).toBe(201);
      const key = MintedKey.parse(minted.json());
      expect(key.limitUsd).toBe(1); // the even share of $4 over 4 shards
      expect(key.anthropicBaseUrl).toBe("https://llm.bench.test/anthropic");
      const fake = bifrost.byName(`bench-${String(githubRun)}-1-${shard.id}`);
      expect(fake?.models).toEqual(["gpt-oss-120b"]);
      // The agent spends, then the job revokes its key.
      if (fake !== undefined) Object.assign(fake, { usageUsd: 0.1, usageTokens: 2000 });
      expect((await call("DELETE", `/v1/runs/${runId}/shards/${shard.id}/key`, "agent")).statusCode).toBe(204);
      expect(fake?.active).toBe(false);
    }
    expect(bifrost.overrides.has("gpt-oss-120b")).toBe(true);

    for (const shard of shards) {
      const trials = [0, 1].map((trial) => trialFor(shard, trial, shard.arm === "with"));
      const uploaded = await call("POST", `/v1/runs/${runId}/trials`, "upload", { shard: shard.id, attempt: 1, artifactId: 77, trials });
      expect(uploaded.statusCode, uploaded.body).toBe(204);
    }

    const completed = await call("POST", `/v1/runs/${runId}/complete`, "upload");
    expect(completed.statusCode, completed.body).toBe(200);
    const completion = CompleteRunResponse.parse(completed.json());
    expect(completion.reportUrl).toBe(`https://bench.test/runs/${runId}`);
    expect(completion.summaryMarkdown).toContain("✅ Helps");
    expect(completion.summaryMarkdown).not.toContain("<script>");
    // Every key was settled, then removed from Bifrost.
    expect([...bifrost.keys.values()].filter((key) => key.name.startsWith(`bench-${String(githubRun)}-`))).toEqual([]);

    const results = Results.parse((await call("GET", `/api/v1/runs/${runId}/results`)).json());
    expect(results.models[0]?.verdict).toBe("helps");
    expect(results.overall.costUsd).toBeCloseTo(0.4);

    const trialsResponse = await call("GET", `/api/v1/runs/${runId}/trials`);
    expect(trialsResponse.headers["content-type"]).toContain("application/x-ndjson");
    const published = trialsResponse.body.trim().split("\n").map((line) => PublishedTrial.parse(JSON.parse(line)));
    expect(published).toHaveLength(8);
    expect(published[0]?.costUsd).toBeCloseTo(0.05);
    expect(published[0]?.artifactUrl).toBe(`https://github.com/axel7083/agent-skills/actions/runs/${String(githubRun)}/artifacts/77`);

    const detail = RunDetail.parse((await call("GET", `/api/v1/runs/${runId}`)).json());
    expect(detail.status).toBe("completed");
    // 2 trials × 1000 tokens reported against 2000 counted by the gateway.
    expect(detail.billing.every((shard) => !shard.tokenMismatch)).toBe(true);

    const report = await call("GET", `/runs/${runId}`);
    expect(report.statusCode).toBe(200);
    expect(report.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(report.body).not.toContain('<script>alert("x")</script>');

    const schema = await call("GET", "/api/v1/schema/v1/published-trial.json");
    expect(schema.json()).toMatchObject({ $schema: "https://json-schema.org/draft/2020-12/schema" });

    // Completing again returns the same answer.
    expect(CompleteRunResponse.parse((await call("POST", `/v1/runs/${runId}/complete`, "upload")).json())).toEqual(completion);
  });
});

describe("who may call what", () => {
  it("refuses a token from another stage", async () => {
    const { runId, shards } = await createRun();
    const shard = shards[0]?.id ?? "";
    expect((await call("POST", `/v1/runs/${runId}/trials`, "agent", { shard, attempt: 1, artifactId: 1, trials: [] })).statusCode).toBe(403);
    expect((await call("POST", `/v1/runs/${runId}/complete`, "agent")).statusCode).toBe(403);
    expect((await call("POST", `/v1/runs/${runId}/shards/${shard}/key`, "upload")).statusCode).toBe(403);
    expect((await call("POST", "/v1/runs", "agent", runRequest)).statusCode).toBe(403);
  });

  it("refuses another workflow run's token", async () => {
    const { runId, shards } = await createRun();
    const response = await call("POST", `/v1/runs/${runId}/shards/${shards[0]?.id ?? ""}/key`, "agent", undefined, { run_id: "999999" });
    expect(response.statusCode).toBe(403);
  });

  it.each([
    ["a branch's workflow", { job_workflow_ref: "axel7083/agent-skills/.github/workflows/bench.yml@refs/heads/feature" }, 401],
    ["another repository", { repository_id: "1" }, 401],
    ["a pull_request_target event", { event_name: "pull_request_target" }, 401],
    ["a self-hosted runner", { runner_environment: "self-hosted" }, 401],
    ["an unprotected ref", { ref_protected: "false" }, 401],
    ["someone not allowed", { actor_id: "1" }, 403],
  ])("refuses %s", async (_name, claims, status) => {
    expect((await call("POST", "/v1/runs", "plan", runRequest, claims)).statusCode).toBe(status);
  });

  it("refuses a missing or forged token", async () => {
    expect((await call("POST", "/v1/runs", undefined, runRequest)).statusCode).toBe(401);
    const forged = await app.inject({ method: "POST", url: "/v1/runs", headers: { authorization: "Bearer a.b.c" }, payload: runRequest });
    expect(forged.statusCode).toBe(401);
  });
});

describe("budgets", () => {
  it("mints one key per shard and attempt", async () => {
    const { runId, shards } = await createRun();
    const url = `/v1/runs/${runId}/shards/${shards[0]?.id ?? ""}/key`;
    expect((await call("POST", url, "agent")).statusCode).toBe(201);
    expect((await call("POST", url, "agent")).statusCode).toBe(409);
    expect((await call("POST", url, "agent", undefined, { run_attempt: "2" })).statusCode).toBe(201);
  });

  it("stops minting once the run's cap is committed, re-runs included", async () => {
    const { runId, shards } = await createRun();
    const minted: number[] = [];
    for (const attempt of ["1", "2"]) {
      for (const shard of shards) {
        const response = await call("POST", `/v1/runs/${runId}/shards/${shard.id}/key`, "agent", undefined, { run_attempt: attempt });
        minted.push(response.statusCode);
      }
    }
    // $4 cap, $1 per shard: every shard gets its key; a re-run finds nothing left until keys settle.
    expect(minted).toEqual([201, 201, 201, 201, 402, 402, 402, 402]);
  });

  it("gives a re-run what settled keys left over", async () => {
    const { runId, shards } = await createRun();
    for (const shard of shards) {
      expect((await call("POST", `/v1/runs/${runId}/shards/${shard.id}/key`, "agent")).statusCode).toBe(201);
      const fake = bifrost.byName(`bench-${String(githubRun)}-1-${shard.id}`);
      if (fake !== undefined) fake.usageUsd = 0.25;
      await call("DELETE", `/v1/runs/${runId}/shards/${shard.id}/key`, "agent");
    }
    // The sweeper reads the usage of disabled keys: $1 spent of $4.
    await app.get(SweeperService).sweep();
    const retried = await call("POST", `/v1/runs/${runId}/shards/${shards[0]?.id ?? ""}/key`, "agent", undefined, { run_attempt: "2" });
    expect(retried.statusCode).toBe(201);
    expect(MintedKey.parse(retried.json()).limitUsd).toBe(1);
  });

  it("allows one running run at a time, and refuses models without a price", async () => {
    await createRun();
    githubRun++;
    expect((await call("POST", "/v1/runs", "plan", runRequest)).statusCode).toBe(409);
    await postgres.exec(["psql", "-U", "bench", "-d", "bench", "-c", "update runs set status = 'abandoned' where status = 'running'"]);
    const unpriced = { ...runRequest, cells: [{ harness: "opencode", model: "unpriced-model" }] };
    expect((await call("POST", "/v1/runs", "plan", unpriced)).statusCode).toBe(422);
  });

  it("refuses trials that don't belong to the shard", async () => {
    const { runId, shards } = await createRun();
    const shard = shards[0];
    if (shard === undefined) throw new Error("no shard");
    const wrongArm = trialFor({ ...shard, arm: shard.arm === "with" ? "without" : "with" }, 0, true);
    const response = await call("POST", `/v1/runs/${runId}/trials`, "upload", { shard: shard.id, attempt: 1, artifactId: 1, trials: [wrongArm] });
    expect(response.statusCode).toBe(422);
  });
});
