/**
 * Renders the report on invented data, to review the charts before any LLM money is spent:
 * `pnpm --filter @podman-desktop/bench-report mockup`, then open dist/mockup/index.html through a
 * local server (the page's CSP only loads same-origin scripts).
 *
 * The three invented models tell the stories the report must make readable: a frontier model that
 * already does well and gets cheaper, a weaker model that gets much better, and a model the skill
 * barely reaches and that breaks a control practice.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  aggregate,
  type CheckResult,
  type EvalSpec,
  type Harness,
  type PublishedTrial,
  seededRandom,
} from "@podman-desktop/bench-contracts";
import { renderReportHtml } from "../src/html.ts";
import { bundle } from "./bundle.ts";

const spec: EvalSpec = {
  skill: "containerfile-best-practices",
  tasks: [
    "containerfile-node-api",
    "containerfile-python-api",
    "containerfile-go-api",
    "containerfile-static-site",
    "containerfile-repair-node",
    "openshift-node-notes",
  ],
  targets: ["fq-image-names", "base-digest-pinned", "healthcheck", "containerfile-name", "containerignore", "numeric-user", "group0-writable"],
  controls: ["non-root-user", "multi-stage", "no-secret-in-image", "exec-form-entrypoint"],
};

const checkTitles: Record<string, string> = {
  "fq-image-names": "Fully qualified image names",
  "base-digest-pinned": "Base image pinned by digest",
  healthcheck: "HEALTHCHECK",
  "containerfile-name": "File named Containerfile",
  containerignore: ".containerignore",
  "numeric-user": "OpenShift: numeric USER",
  "group0-writable": "OpenShift: group 0 writable dirs",
  "non-root-user": "Non-root user",
  "multi-stage": "Multi-stage build",
  "no-secret-in-image": "No secret in the image",
  "exec-form-entrypoint": "Exec-form entrypoint",
};

/** Checks that only apply to the OpenShift task. */
const OPENSHIFT_ONLY = new Set(["numeric-user", "group0-writable"]);

interface Profile {
  readonly harness: Harness;
  readonly model: string;
  readonly triggerRate: number;
  readonly works: { readonly without: number; readonly with: number };
  /** Pass probability per check, without the skill and when the skill was loaded. */
  readonly without: Readonly<Record<string, number>>;
  readonly with: Readonly<Record<string, number>>;
  readonly tokens: number;
  readonly tokensFactor: number;
  readonly turns: number;
  readonly turnsWith: number;
  readonly seconds: number;
  readonly secondsWith: number;
  readonly usdPerMillionTokens: number;
}

const CONTROLS_GOOD = { "non-root-user": 0.92, "multi-stage": 0.95, "no-secret-in-image": 1, "exec-form-entrypoint": 0.97 };

const profiles: readonly Profile[] = [
  {
    harness: "claude-code",
    model: "claude-sonnet-5.5",
    triggerRate: 0.93,
    works: { without: 1, with: 1 },
    without: { "fq-image-names": 0.62, "base-digest-pinned": 0.5, healthcheck: 0.55, "containerfile-name": 0.85, containerignore: 0.8, "numeric-user": 0.7, "group0-writable": 0.6, ...CONTROLS_GOOD },
    with: { "fq-image-names": 0.98, "base-digest-pinned": 0.95, healthcheck: 0.97, "containerfile-name": 1, containerignore: 0.97, "numeric-user": 1, "group0-writable": 0.95, ...CONTROLS_GOOD },
    tokens: 120_000,
    tokensFactor: 0.82,
    turns: 14,
    turnsWith: 11,
    seconds: 140,
    secondsWith: 118,
    usdPerMillionTokens: 1.6,
  },
  {
    harness: "opencode",
    model: "gpt-oss-120b",
    triggerRate: 0.62,
    works: { without: 0.95, with: 0.95 },
    without: { "fq-image-names": 0.15, "base-digest-pinned": 0.05, healthcheck: 0.1, "containerfile-name": 0.5, containerignore: 0.4, "numeric-user": 0.2, "group0-writable": 0.2, ...CONTROLS_GOOD, "multi-stage": 0.85 },
    with: { "fq-image-names": 0.85, "base-digest-pinned": 0.75, healthcheck: 0.9, "containerfile-name": 0.92, containerignore: 0.85, "numeric-user": 0.8, "group0-writable": 0.6, ...CONTROLS_GOOD, "multi-stage": 0.85 },
    tokens: 60_000,
    tokensFactor: 1.12,
    turns: 18,
    turnsWith: 19,
    seconds: 95,
    secondsWith: 104,
    usdPerMillionTokens: 0.2,
  },
  {
    harness: "opencode",
    model: "glm-4.6-flash",
    triggerRate: 0.45,
    works: { without: 0.9, with: 0.86 },
    without: { "fq-image-names": 0.35, "base-digest-pinned": 0.1, healthcheck: 0.2, "containerfile-name": 0.6, containerignore: 0.5, "numeric-user": 0.3, "group0-writable": 0.3, ...CONTROLS_GOOD },
    with: { "fq-image-names": 0.45, "base-digest-pinned": 0.2, healthcheck: 0.3, "containerfile-name": 0.6, containerignore: 0.5, "numeric-user": 0.3, "group0-writable": 0.3, ...CONTROLS_GOOD, "multi-stage": 0.55, "non-root-user": 0.75 },
    tokens: 80_000,
    tokensFactor: 1.25,
    turns: 22,
    turnsWith: 25,
    seconds: 120,
    secondsWith: 138,
    usdPerMillionTokens: 0.4,
  },
];

const TRIALS = 5;
const SHA = "3f2a1c9e5b7d4a6c8e0f1a2b3c4d5e6f7a8b9c0d";
const random = seededRandom(17);

/** Log-normal noise around a median, so token counts look like real ones (long right tail). */
function around(median: number, spread = 0.25): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(normal * spread);
}

function trials(): PublishedTrial[] {
  const out: PublishedTrial[] = [];
  let index = 0;
  for (const profile of profiles) {
    for (const task of spec.tasks) {
      for (const arm of ["without", "with"] as const) {
        for (let trial = 0; trial < TRIALS; trial++) {
          const triggered = arm === "with" && random() < profile.triggerRate;
          // A skill that wasn't loaded can't help: those trials behave like the baseline.
          const probabilities = triggered ? profile.with : profile.without;
          const works = random() < (arm === "with" ? profile.works.with : profile.works.without);
          const checks: Record<string, CheckResult> = {};
          for (const check of [...spec.targets, ...spec.controls]) {
            if (OPENSHIFT_ONLY.has(check) && task !== "openshift-node-notes") {
              checks[check] = { status: "na", evidence: "not an OpenShift task" };
              continue;
            }
            const passed = random() < (probabilities[check] ?? 0.5);
            checks[check] = { status: passed ? "pass" : "fail", evidence: passed ? "" : "synthetic failure" };
          }
          const tokens = Math.round(around(arm === "with" ? profile.tokens * profile.tokensFactor : profile.tokens));
          const cached = Math.round(tokens * 0.4);
          const output = Math.round(tokens * 0.03);
          out.push({
            schemaVersion: 1,
            skill: spec.skill,
            arm,
            harness: profile.harness,
            model: profile.model,
            task,
            attempt: 1,
            trial,
            works,
            failureClass: works ? "none" : "probe",
            checks,
            agentSeconds: Math.round(around(arm === "with" ? profile.secondsWith : profile.seconds, 0.2)),
            agentReported: {
              triggered,
              tokens: { input: tokens - cached - output, cached, output },
              turns: Math.max(1, Math.round(around(arm === "with" ? profile.turnsWith : profile.turns, 0.2))),
              toolCalls: Math.max(1, Math.round(around(arm === "with" ? profile.turnsWith : profile.turns, 0.2))),
            },
            graderCommit: SHA,
            transcriptPath: `${task}/${arm}/${trial}/trajectory.json`,
            shard: `${profile.model.replaceAll(".", "-")}-${arm}-${task}`,
            costUsd: (tokens / 1_000_000) * profile.usdPerMillionTokens,
            artifactUrl: `https://github.com/podman-desktop/agent-skills/actions/runs/1/artifacts/${++index}`,
          });
        }
      }
    }
  }
  return out;
}

const outDir = join(import.meta.dirname, "..", "dist", "mockup");
const data = trials();
const results = aggregate({
  spec,
  skillSha: SHA,
  skillVersion: "0.1.0",
  trials: data,
  costUsd: data.reduce((sum, trial) => sum + trial.costUsd, 0),
  maxUsd: 40,
  checkTitles,
});

await bundle(outDir);
await writeFile(join(outDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(outDir, "trials.ndjson"), data.map((trial) => JSON.stringify(trial)).join("\n") + "\n");
await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "index.html"),
  renderReportHtml({ results, trials: data, scriptUrl: "report.js", styleUrl: "report.css", synthetic: true }),
);
console.log(`mockup written to ${outDir}`);
