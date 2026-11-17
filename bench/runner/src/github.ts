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

import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { z } from "zod";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/** Hides a value from the job's log from now on. */
export function mask(value: string): void {
  console.log(`::add-mask::${value}`);
}

export function setOutput(name: string, value: string): void {
  const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
  appendFileSync(required("GITHUB_OUTPUT"), `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

export function appendSummary(markdown: string): void {
  const path = process.env["GITHUB_STEP_SUMMARY"];
  if (path === undefined) console.log(markdown);
  else appendFileSync(path, `${markdown}\n`);
}

/** A GitHub Actions OIDC token for `audience`; needs `id-token: write`. */
export async function oidcToken(audience: string): Promise<string> {
  const url = new URL(required("ACTIONS_ID_TOKEN_REQUEST_URL"));
  url.searchParams.set("audience", audience);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${required("ACTIONS_ID_TOKEN_REQUEST_TOKEN")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OIDC token request failed: HTTP ${String(response.status)}`);
  const body: unknown = await response.json();
  const value = typeof body === "object" && body !== null && "value" in body ? body.value : undefined;
  if (typeof value !== "string") throw new Error("OIDC token response without a value");
  return value;
}

const ArtifactPage = z.object({ artifacts: z.array(z.object({ id: z.number(), name: z.string() })) });

/** The workflow run's artifacts, by name: their ids, for the links the server publishes. */
export async function runArtifacts(): Promise<Map<string, number>> {
  const repository = required("GITHUB_REPOSITORY");
  const runId = required("GITHUB_RUN_ID");
  const ids = new Map<string, number>();
  for (let page = 1; ; page++) {
    const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${String(page)}`, {
      headers: { authorization: `Bearer ${required("GITHUB_TOKEN")}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`listing artifacts failed: HTTP ${String(response.status)}`);
    const { artifacts } = ArtifactPage.parse(await response.json());
    for (const artifact of artifacts) ids.set(artifact.name, artifact.id);
    if (artifacts.length < 100) return ids;
  }
}
