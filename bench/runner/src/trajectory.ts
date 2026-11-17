import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentReported } from "@podman-desktop/bench-contracts";
import { z } from "zod";

/** The fields of Harbor's `result.json` we read. `n_input_tokens` includes cached tokens. */
const HarborResult = z.looseObject({
  agent_result: z
    .looseObject({
      n_input_tokens: z.number().nullish(),
      n_cache_tokens: z.number().nullish(),
      n_output_tokens: z.number().nullish(),
    })
    .nullish(),
  exception_info: z.looseObject({ exception_type: z.string() }).nullish(),
  agent_execution: z.looseObject({ started_at: z.string().nullish(), finished_at: z.string().nullish() }).nullish(),
});

/** ATIF trajectory: the steps and their tool calls. */
const Trajectory = z.looseObject({
  steps: z
    .array(
      z.looseObject({
        source: z.string(),
        tool_calls: z.array(z.looseObject({ function_name: z.string().optional(), arguments: z.unknown().optional() })).nullish(),
      }),
    )
    .default([]),
});

export interface TrialRecord {
  readonly agentReported: AgentReported;
  readonly agentSeconds: number;
  /** Harbor's exception class, e.g. `AgentTimeoutError`, when the agent didn't finish. */
  readonly exception: string | undefined;
}

/**
 * Whether the agent loaded the skill: a tool call that reads its directory (`…/skills/<name>/…`),
 * or a harness's skill tool called with its name.
 */
export function triggered(trajectory: z.infer<typeof Trajectory>, skill: string): boolean {
  const path = `skills/${skill}`;
  return trajectory.steps.some((step) =>
    (step.tool_calls ?? []).some((call) => {
      const args = JSON.stringify(call.arguments ?? "");
      return args.includes(path) || (/skill/i.test(call.function_name ?? "") && args.includes(skill));
    }),
  );
}

/** Reads one trial's `result.json` and `trajectory.json`, both agent-side files: never trusted beyond parsing. */
export function readTrial(dir: string, skill: string): TrialRecord {
  const result = HarborResult.parse(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")));
  const trajectoryPath = join(dir, "trajectory.json");
  const trajectory = existsSync(trajectoryPath) ? Trajectory.parse(JSON.parse(readFileSync(trajectoryPath, "utf8"))) : { steps: [] };
  const usage = result.agent_result;
  const input = Math.max(0, Math.round(usage?.n_input_tokens ?? 0));
  const cached = Math.min(input, Math.max(0, Math.round(usage?.n_cache_tokens ?? 0)));
  const agentSteps = trajectory.steps.filter((step) => step.source === "agent");
  const started = Date.parse(result.agent_execution?.started_at ?? "");
  const finished = Date.parse(result.agent_execution?.finished_at ?? "");
  return {
    agentReported: {
      triggered: triggered(trajectory, skill),
      tokens: { input: input - cached, cached, output: Math.max(0, Math.round(usage?.n_output_tokens ?? 0)) },
      turns: agentSteps.length,
      toolCalls: agentSteps.reduce((sum, step) => sum + (step.tool_calls?.length ?? 0), 0),
    },
    agentSeconds: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, (finished - started) / 1000) : 0,
    exception: result.exception_info?.exception_type,
  };
}
