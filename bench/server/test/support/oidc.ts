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

import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";

export const AUDIENCE = "https://bench.test";
export const REPOSITORY = "axel7083/agent-skills";
export const REPOSITORY_ID = 1_444_086_302;
export const OWNER_ID = 42_176_370;
export const ACTOR_ID = 42_176_370;

export interface TestIssuer {
  readonly keys: JWTVerifyGetKey;
  token(claims?: Record<string, unknown>): Promise<string>;
}

/** A stand-in for GitHub's OIDC issuer: its own key pair, the claims of a bench workflow job. */
export async function testIssuer(): Promise<TestIssuer> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    token: (claims = {}) =>
      new SignJWT({
        repository: REPOSITORY,
        repository_id: String(REPOSITORY_ID),
        repository_owner_id: String(OWNER_ID),
        job_workflow_ref: `${REPOSITORY}/.github/workflows/bench.yml@refs/heads/main`,
        ref: "refs/heads/main",
        ref_protected: "true",
        event_name: "workflow_dispatch",
        actor_id: String(ACTOR_ID),
        runner_environment: "github-hosted",
        run_id: "1001",
        run_attempt: "1",
        environment: "bench-plan",
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer("https://token.actions.githubusercontent.com")
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey),
  };
}
