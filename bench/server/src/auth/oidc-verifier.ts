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

import { Inject, Injectable } from "@nestjs/common";
import { createRemoteJWKSet, errors as joseErrors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";
import { Forbidden, OidcRejected } from "../common/errors.ts";
import { APP_ENV, type AppEnv } from "../config/env.ts";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

/** Resolves the signing keys of GitHub's OIDC issuer. Swappable in tests. */
export const OIDC_KEYS = Symbol("OIDC_KEYS");

export function githubJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`), { cooldownDuration: 60_000 });
}

/**
 * The bench workflow's jobs, each in its own GitHub environment. A token can only call its own
 * stage's endpoints: an agent that mints a token from inside its job gets `bench-agent`, which can
 * mint or revoke its run's keys, never upload results.
 */
export const STAGES = ["plan", "agent", "upload"] as const;
export type Stage = (typeof STAGES)[number];

/** GitHub sends numeric ids as strings. */
const NumericString = z.string().regex(/^[0-9]+$/).transform(Number);

const ActionsClaims = z.looseObject({
  repository_id: NumericString,
  repository_owner_id: NumericString,
  job_workflow_ref: z.string(),
  ref: z.string(),
  ref_protected: z.string(),
  event_name: z.string(),
  actor_id: NumericString,
  runner_environment: z.string(),
  run_id: NumericString,
  run_attempt: NumericString,
  environment: z.string().optional(),
});

/** Who is calling: a job of one bench workflow run. */
export interface Principal {
  readonly githubRunId: number;
  readonly runAttempt: number;
  readonly actorId: number;
  readonly stage: Stage;
}

@Injectable()
export class OidcVerifier {
  private readonly expectedWorkflowRef: string;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(OIDC_KEYS) private readonly keys: JWTVerifyGetKey,
  ) {
    this.expectedWorkflowRef = `${env.GITHUB_REPOSITORY}/.github/workflows/${env.BENCH_WORKFLOW}@refs/heads/main`;
  }

  /** Verifies the token, checks it comes from the bench workflow on main, and that its job is the `stage`'s. */
  async verify(token: string, stage: Stage): Promise<Principal> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: GITHUB_OIDC_ISSUER,
        audience: this.env.PUBLIC_URL,
        algorithms: ["RS256"],
        maxTokenAge: "10m",
      }));
    } catch (error: unknown) {
      const reason = error instanceof joseErrors.JOSEError ? error.code : "unverifiable token";
      throw new OidcRejected(`token rejected: ${reason}`);
    }

    const parsed = ActionsClaims.safeParse(payload);
    if (!parsed.success) throw new OidcRejected("not a GitHub Actions token");
    const claims = parsed.data;

    const mismatches = [
      claims.repository_id !== this.env.GITHUB_REPOSITORY_ID && "repository_id",
      claims.repository_owner_id !== this.env.GITHUB_OWNER_ID && "repository_owner_id",
      // The workflow file on main: a branch or a fork can't run its own version of the workflow with our trust.
      claims.job_workflow_ref !== this.expectedWorkflowRef && "job_workflow_ref",
      claims.ref !== "refs/heads/main" && "ref",
      this.env.REQUIRE_PROTECTED_REF && claims.ref_protected !== "true" && "ref_protected",
      claims.event_name !== "workflow_dispatch" && "event_name",
      // A self-hosted runner label must never receive a key.
      claims.runner_environment !== "github-hosted" && "runner_environment",
    ].filter((field): field is string => field !== false);
    if (mismatches.length > 0) throw new OidcRejected(`unexpected claims: ${mismatches.join(", ")}`);
    if (!this.env.ALLOWED_ACTOR_IDS.has(claims.actor_id)) throw new Forbidden(`actor ${String(claims.actor_id)} may not run benchmarks`);
    if (claims.environment !== `bench-${stage}`) throw new Forbidden(`environment ${claims.environment ?? "(none)"} can't call a ${stage} endpoint`);

    return { githubRunId: claims.run_id, runAttempt: claims.run_attempt, actorId: claims.actor_id, stage };
  }
}
