import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Slug, Trial } from "@podman-desktop/bench-contracts";
import { z } from "zod";
import { appendSummary, runArtifacts } from "../github.ts";
import { ServerClient } from "../server-client.ts";

const GradedShard = z.strictObject({ shard: Slug, attempt: z.int().min(1), trials: z.array(Trial) });

/** Never published: a gateway key in a trial means the redaction failed somewhere. */
const KEY_PATTERN = /sk-bf-[0-9a-f-]{20,}/;

export interface CompleteOptions {
  readonly server: string;
  readonly runId: string;
  /** Downloaded `graded-<shard>` artifacts, one directory each holding `trials.json`. */
  readonly input: string;
}

/**
 * Uploads every shard's graded trials, then closes the run. Runs no code from the agents: it only
 * parses JSON, and the artifact links it sends are built from the workflow run, never read from files.
 */
export async function complete(options: CompleteOptions): Promise<void> {
  const artifacts = await runArtifacts();
  const server = new ServerClient(options.server);
  const dirs = existsSync(options.input) ? readdirSync(options.input).filter((name) => name.startsWith("graded-")).sort() : [];
  for (const dir of dirs) {
    const path = join(options.input, dir, "trials.json");
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    if (KEY_PATTERN.test(text)) throw new Error(`${dir}: a gateway key appears in the graded trials`);
    const graded = GradedShard.parse(JSON.parse(text));
    const artifactId = artifacts.get(`agent-${graded.shard}`);
    if (artifactId === undefined) {
      console.log(`${graded.shard}: no agent artifact, skipped`);
      continue;
    }
    await server.uploadTrials(options.runId, { shard: graded.shard, attempt: graded.attempt, artifactId, trials: graded.trials });
    console.log(`${graded.shard}: ${String(graded.trials.length)} trials uploaded`);
  }
  const completion = await server.complete(options.runId);
  appendSummary(completion.summaryMarkdown);
  console.log(`report: ${completion.reportUrl}`);
}
