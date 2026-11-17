import { execFile } from "node:child_process";

export interface ExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Runs a command without a shell. A non-zero exit is a result, not an error: callers decide.
 * `env` replaces the environment entirely when given.
 */
export function run(
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs?: number; readonly env?: NodeJS.ProcessEnv; readonly cwd?: string; readonly input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 32 * 1024 * 1024,
        killSignal: "SIGKILL",
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      },
      (error, stdout, stderr) => {
        const timedOut = error?.killed ?? false;
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ code, stdout, stderr, timedOut });
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

/** The last `max` characters, for evidence and logs. */
export function tail(text: string, max = 600): string {
  return text.length <= max ? text : `…${text.slice(-max)}`;
}
