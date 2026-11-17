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

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { CheckResult, FailureClass } from "@podman-desktop/agent-skills-bench-server-client";
import { run, tail } from "../exec.ts";
import type { TaskSpec } from "../tasks.ts";
import { CHECKS } from "./checks.ts";
import { type Containerfile, MAX_CONTAINERFILE_BYTES, parseContainerfile } from "./containerfile.ts";
import type { Grade, GradeContext, RuntimeFacts } from "./model.ts";

const BUILD_TIMEOUT_MS = 15 * 60_000;
const START_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE = 1024;
/** Top-level image directories the secret search skips: the OS, not the app. */
const SYSTEM_DIRS = ["proc", "sys", "dev", "usr", "lib", "lib64", "bin", "sbin", "etc", "var"];

/** Build files, in the order the grader looks for them. */
const NAMES = ["Containerfile", "Dockerfile", "containerfile", "dockerfile"];

/** The build file in the app directory, relative to it: at its root first, else up to 3 levels down. */
export function findContainerfile(appDir: string): string | undefined {
  for (const name of NAMES) if (existsSync(join(appDir, name))) return name;
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && /^(container|docker)file(\..*)?$/i.test(entry.name)) found.push(relative(appDir, path));
    }
  };
  walk(appDir, 1);
  return found.sort()[0];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

async function httpStatus(url: string, init: RequestInit = {}): Promise<{ status: number; body: string } | null> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(3_000) });
    const body = (await response.text()).slice(0, 65_536);
    return { status: response.status, body };
  } catch {
    return null;
  }
}

function looksLikeInfra(output: string): boolean {
  return /toomanyrequests|rate limit|i\/o timeout|TLS handshake timeout|no space left on device/i.test(output);
}

function truncate(evidence: string): string {
  return evidence.length <= MAX_EVIDENCE ? evidence : `${evidence.slice(0, MAX_EVIDENCE - 1)}…`;
}

/**
 * Grades an app directory: rebuilds its image from scratch, runs it under the task's constraints,
 * probes it, then evaluates every check. Runs on a runner that holds no credential: the agent's
 * files are untrusted, and so is what they build.
 */
export async function gradeApp(spec: TaskSpec, appDir: string): Promise<Grade> {
  const log: string[] = [];
  const runtime: RuntimeFacts = {};
  const containerfilePath = findContainerfile(appDir);
  let containerfile: Containerfile | undefined;
  if (containerfilePath !== undefined) {
    const path = join(appDir, containerfilePath);
    if (statSync(path).size <= MAX_CONTAINERFILE_BYTES) {
      try {
        containerfile = parseContainerfile(readFileSync(path, "utf8"));
      } catch (error: unknown) {
        log.push(`parse: ${String(error)}`);
      }
    }
  }

  const failureClass = containerfilePath === undefined ? "no-artifact" : await imageGate(spec, appDir, containerfilePath, runtime, log);
  const context: GradeContext = { spec, appDir, containerfilePath, containerfile, runtime };
  const checks: Record<string, CheckResult> = {};
  for (const check of CHECKS) {
    try {
      const [status, evidence] = check.evaluate(context);
      checks[check.id] = { status, evidence: truncate(evidence) };
    } catch (error: unknown) {
      checks[check.id] = { status: "error", evidence: truncate(`grader error: ${String(error)}`) };
    }
  }
  return { works: failureClass === "none", failureClass, checks, log };
}

async function imageGate(spec: TaskSpec, appDir: string, containerfilePath: string, runtime: RuntimeFacts, log: string[]): Promise<FailureClass> {
  const id = randomBytes(6).toString("hex");
  const image = `localhost/bench-verify:${id}`;
  const container = `bench-verify-${id}`;
  try {
    const build = await run(
      "podman",
      ["build", "--no-cache", "--pull=missing", "--format", "docker", "-t", image, "-f", join(appDir, containerfilePath), join(appDir, dirname(containerfilePath))],
      { timeoutMs: BUILD_TIMEOUT_MS },
    );
    log.push(`build: exit ${String(build.code)}\n${tail(build.stdout + build.stderr, 2000)}`);
    if (build.timedOut) return "build";
    if (build.code !== 0) return looksLikeInfra(build.stderr) ? "infra" : "build";

    await inspectImage(spec, image, runtime, log);
    const port = spec.run?.portFromImage === true ? (runtime.exposedPorts?.[0] ?? spec.app.port) : spec.app.port;
    const hostPort = await freePort();
    const started = await run("podman", [
      "run",
      "-d",
      "--name",
      container,
      "-p",
      `127.0.0.1:${String(hostPort)}:${String(port)}`,
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "512",
      "--memory",
      "1g",
      "--cpus",
      "2",
      ...(spec.run?.args ?? []),
      image,
    ]);
    log.push(`run: exit ${String(started.code)} ${tail(started.stderr)}`);
    if (started.code !== 0) return "start";

    const base = `http://127.0.0.1:${String(hostPort)}`;
    const deadline = Date.now() + START_TIMEOUT_MS;
    let answered = false;
    while (Date.now() < deadline) {
      const state = await run("podman", ["inspect", "-f", "{{.State.Running}}", container]);
      if (state.stdout.trim() !== "true") {
        const logs = await run("podman", ["logs", "--tail", "30", container]);
        log.push(`container exited:\n${tail(logs.stdout + logs.stderr)}`);
        return "start";
      }
      const response = await httpStatus(`${base}${spec.probe.path}`);
      if (response !== null && response.status === spec.probe.status && (spec.probe.body === undefined || response.body.includes(spec.probe.body))) {
        answered = true;
        break;
      }
      await sleep(1_000);
    }

    // The task forced the user (OpenShift): the running user says nothing about the image's own.
    const forcedUser = (spec.run?.args ?? []).some((arg) => arg === "--user" || arg.startsWith("--user="));
    if (!forcedUser) {
      // In-container UIDs: `user` would resolve names against the host's /etc/passwd.
      const top = await run("podman", ["top", container, "uid"]);
      if (top.code === 0) runtime.processUsers = top.stdout.split("\n").slice(1).map((line) => line.trim()).filter((line) => line !== "");
    }
    if (spec.openshift !== undefined && answered) {
      const write = await httpStatus(`${base}${spec.openshift.writePath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "bench" }),
      });
      runtime.openshiftWriteStatus = write?.status ?? null;
    }
    if (!answered) {
      const logs = await run("podman", ["logs", "--tail", "30", container]);
      log.push(`probe failed:\n${tail(logs.stdout + logs.stderr)}`);
      return "probe";
    }
    return "none";
  } finally {
    await run("podman", ["rm", "-f", "-t", "0", container]);
    await run("podman", ["rmi", "-f", image]);
  }
}

const ImageInspect = (value: unknown): { size?: number; user?: string; ports: number[] } => {
  const first: unknown = Array.isArray(value) ? value[0] : undefined;
  if (typeof first !== "object" || first === null) return { ports: [] };
  const record = new Map(Object.entries(first));
  const config: unknown = record.get("Config");
  const configRecord = typeof config === "object" && config !== null ? new Map(Object.entries(config)) : new Map<string, unknown>();
  const exposed: unknown = configRecord.get("ExposedPorts");
  const ports =
    typeof exposed === "object" && exposed !== null
      ? Object.keys(exposed)
          .map((key) => Number(key.split("/")[0]))
          .filter((port) => Number.isInteger(port) && port > 0)
          .sort((a, b) => a - b)
      : [];
  const size: unknown = record.get("Size");
  const user: unknown = configRecord.get("User");
  return { ...(typeof size === "number" ? { size } : {}), user: typeof user === "string" ? user : "", ports };
};

async function inspectImage(spec: TaskSpec, image: string, runtime: RuntimeFacts, log: string[]): Promise<void> {
  const inspected = await run("podman", ["image", "inspect", image]);
  if (inspected.code === 0) {
    const facts = ImageInspect(JSON.parse(inspected.stdout));
    if (facts.size !== undefined) runtime.imageSizeBytes = facts.size;
    runtime.imageUser = facts.user ?? "";
    runtime.exposedPorts = facts.ports;
  }
  const canary = spec.canary?.value;
  if (canary === undefined) return;
  const history = await run("podman", ["history", "--no-trunc", "--format", "{{.CreatedBy}}", image]);
  runtime.canaryInHistory = history.stdout.includes(canary);
  // Rootless Podman mounts images inside its user namespace only. The canary goes through the
  // environment, never into the script.
  const script = [
    'm=$(podman image mount "$IMAGE") || exit 2',
    "found=1",
    'for d in "$m"/* "$m"/.[!.]*; do',
    '  [ -e "$d" ] || continue',
    `  case "\${d##*/}" in ${SYSTEM_DIRS.join("|")}) continue;; esac`,
    '  if grep -rqF -- "$CANARY" "$d" 2>/dev/null; then found=0; break; fi',
    "done",
    'podman image unmount "$IMAGE" >/dev/null',
    'exit "$found"',
  ].join("\n");
  const search = await run("podman", ["unshare", "sh", "-c", script], { env: { ...process.env, IMAGE: image, CANARY: canary } });
  if (search.code === 0) runtime.canaryInFilesystem = true;
  else if (search.code === 1) runtime.canaryInFilesystem = false;
  else log.push(`secret search failed: ${tail(search.stderr)}`);
}
