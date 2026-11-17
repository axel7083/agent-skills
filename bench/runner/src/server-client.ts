import {
  CompleteRunResponse,
  type CreateRunRequest,
  CreateRunResponse,
  MintedKey,
  type UploadTrialsRequest,
} from "@podman-desktop/bench-contracts";
import type { z } from "zod";
import { oidcToken } from "./github.ts";

/** The bench server, called with a fresh OIDC token each time (the server accepts them 10 minutes). */
export class ServerClient {
  constructor(private readonly baseUrl: string) {}

  createRun(request: CreateRunRequest): Promise<CreateRunResponse> {
    return this.call("POST", "/v1/runs", CreateRunResponse, request);
  }

  mintKey(runId: string, shard: string): Promise<MintedKey> {
    return this.call("POST", `/v1/runs/${runId}/shards/${shard}/key`, MintedKey);
  }

  async revokeKey(runId: string, shard: string): Promise<void> {
    await this.call("DELETE", `/v1/runs/${runId}/shards/${shard}/key`, undefined);
  }

  async uploadTrials(runId: string, upload: UploadTrialsRequest): Promise<void> {
    await this.call("POST", `/v1/runs/${runId}/trials`, undefined, upload);
  }

  complete(runId: string): Promise<CompleteRunResponse> {
    return this.call("POST", `/v1/runs/${runId}/complete`, CompleteRunResponse);
  }

  private async call<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T>;
  private async call(method: string, path: string, schema: undefined, body?: unknown): Promise<undefined>;
  private async call<T>(method: string, path: string, schema: z.ZodType<T> | undefined, body?: unknown): Promise<T | undefined> {
    const token = await oidcToken(this.baseUrl);
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${String(response.status)} ${text.slice(0, 200)}`);
    return schema === undefined ? undefined : schema.parse(JSON.parse(text));
  }
}
