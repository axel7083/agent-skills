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

import type {
  CompleteRunResponse,
  CreateRunRequest,
  CreateRunResponse,
  MintedKey,
  UploadTrialsRequest,
} from "@podman-desktop/agent-skills-bench-server-client";
import { completeRun, createRun, mintKey, revokeKey, uploadTrials } from "@podman-desktop/agent-skills-bench-server-client";
import { createClient } from "@podman-desktop/agent-skills-bench-server-client/client";
import { oidcToken } from "./github.ts";

/**
 * The bench server, through the client generated from its OpenAPI document: requests and
 * responses are validated against it. Each call carries a fresh OIDC token (the server accepts
 * them for 10 minutes; the agent job outlives that).
 */
export class ServerClient {
  private readonly client: ReturnType<typeof createClient>;

  constructor(baseUrl: string) {
    this.client = createClient({ baseUrl, auth: () => oidcToken(baseUrl), throwOnError: true });
  }

  async createRun(request: CreateRunRequest): Promise<CreateRunResponse> {
    const { data } = await createRun({ client: this.client, body: request, throwOnError: true });
    return data;
  }

  async mintKey(runId: string, shard: string): Promise<MintedKey> {
    const { data } = await mintKey({ client: this.client, path: { run: runId, shard }, throwOnError: true });
    return data;
  }

  async revokeKey(runId: string, shard: string): Promise<void> {
    await revokeKey({ client: this.client, path: { run: runId, shard }, throwOnError: true });
  }

  async uploadTrials(runId: string, upload: UploadTrialsRequest): Promise<void> {
    await uploadTrials({ client: this.client, path: { run: runId }, body: upload, throwOnError: true });
  }

  async complete(runId: string): Promise<CompleteRunResponse> {
    const { data } = await completeRun({ client: this.client, path: { run: runId }, throwOnError: true });
    return data;
  }
}
