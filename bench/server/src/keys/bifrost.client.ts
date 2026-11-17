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

import { Logger } from "@nestjs/common";
import { z } from "zod";
import { UpstreamError } from "../common/errors.ts";
import type { PriceList, PricePatch } from "./prices.ts";

/** Only the fields we use: the rest of Bifrost's objects can change without breaking us. */
const CreatedKey = z.object({ virtual_key: z.object({ id: z.string(), value: z.string() }) });
const KeyUsage = z.object({
  virtual_key: z.object({
    budgets: z.array(z.object({ current_usage: z.coerce.number() })).nullish(),
    rate_limit: z.object({ token_current_usage: z.coerce.number().optional() }).nullish(),
  }),
});
/** An empty list comes back as `null` (Go's nil slice). The stored patch is a JSON string, `pricing_patch`. */
const Overrides = z.object({
  pricing_overrides: z
    .array(z.object({ id: z.string().optional(), pattern: z.string().optional(), pricing_patch: z.string().optional(), patch: z.unknown().optional() }))
    .nullish(),
});
const StoredPatch = z.record(z.string(), z.unknown());
const Ignored = z.unknown();

/** Request types a run's harnesses send: OpenAI chat and responses, and Anthropic messages (Bifrost's `responses`). */
const PRICED_REQUESTS = ["chat_completion", "responses"];

/**
 * Budgets can't be one-off in Bifrost (`reset_duration` is required). A key expires within hours,
 * so a yearly reset never happens in its lifetime.
 */
const BUDGET_RESET = "1Y";

export interface BifrostSettings {
  readonly adminUrl: string;
  readonly username: string;
  readonly password: string;
  readonly requestsPerMinute: number;
}

export interface KeyRequest {
  /** The Bifrost provider the key may use. */
  readonly provider: string;
  readonly name: string;
  readonly limitUsd: number;
  readonly expiresAt: Date;
  readonly models: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
}

export interface KeyUsage {
  readonly usd: number;
  readonly tokens: number;
}

/**
 * Virtual keys over the providers holding the upstream key. Authenticated with Bifrost's admin
 * credentials, which never leave this class; the admin API is reachable from the server only.
 */
export class BifrostClient {
  private readonly logger = new Logger(BifrostClient.name);
  private readonly authorization: string;

  constructor(
    private readonly settings: BifrostSettings,
    private readonly prices: PriceList,
  ) {
    this.authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString("base64")}`;
  }

  async create(request: KeyRequest): Promise<{ readonly key: string; readonly id: string }> {
    const models = [...new Set(request.models)];
    await this.ensurePrices(request.provider, models);
    const created = await this.request("create key", "POST", "/api/governance/virtual-keys", CreatedKey, {
      name: request.name,
      metadata: request.metadata,
      provider_configs: [{ provider: request.provider, allowed_models: models, key_ids: ["*"] }],
      budgets: [{ max_limit: request.limitUsd, reset_duration: BUDGET_RESET }],
      rate_limit: { request_max_limit: this.settings.requestsPerMinute, request_reset_duration: "1m" },
      expires_at: request.expiresAt.toISOString(),
      // Settlement reads the usage after the run; the server deletes the key afterwards.
      delete_after_expire: false,
      disable_content_logging: true,
    });
    return { key: created.virtual_key.value, id: created.virtual_key.id };
  }

  /** Spending stops at once; usage stays readable until the key is deleted. */
  async disable(id: string): Promise<void> {
    await this.request("disable key", "PUT", `/api/governance/virtual-keys/${encodeURIComponent(id)}`, Ignored, { is_active: false });
  }

  /** The key's spend and token counter, read live from Bifrost's memory. */
  async usage(id: string): Promise<KeyUsage> {
    const { virtual_key: key } = await this.request("read key usage", "GET", `/api/governance/virtual-keys/${encodeURIComponent(id)}?from_memory=true`, KeyUsage);
    return {
      usd: (key.budgets ?? []).reduce((total, budget) => total + budget.current_usage, 0),
      tokens: key.rate_limit?.token_current_usage ?? 0,
    };
  }

  async delete(id: string): Promise<void> {
    try {
      await this.request("delete key", "DELETE", `/api/governance/virtual-keys/${encodeURIComponent(id)}`, Ignored);
    } catch (error: unknown) {
      if (error instanceof UpstreamError && error.status === 404) return;
      throw error;
    }
  }

  /** One provider-scoped price override per model, created or brought back to the pinned price. */
  private async ensurePrices(provider: string, models: readonly string[]): Promise<void> {
    const query = new URLSearchParams({ scope_kind: "provider", provider_id: provider });
    const listed = await this.request("list price overrides", "GET", `/api/governance/pricing-overrides?${query.toString()}`, Overrides);
    const existing = new Map<string, { readonly id: string | undefined; readonly patch: unknown }>();
    for (const override of listed.pricing_overrides ?? []) {
      if (override.pattern !== undefined) existing.set(override.pattern, { id: override.id, patch: storedPatch(override.pricing_patch) ?? override.patch });
    }
    for (const model of models) {
      const patch = this.prices.patch(model);
      if (patch === undefined) throw new UpstreamError("bifrost", `no price for ${model}`, undefined);
      const current = existing.get(model);
      if (current === undefined) {
        const body = { name: `${provider} ${model}`, scope_kind: "provider", provider_id: provider, match_type: "exact", pattern: model, request_types: PRICED_REQUESTS, patch };
        await this.request("create price override", "POST", "/api/governance/pricing-overrides", Ignored, body);
        this.logger.log(`price override created for ${model}`);
      } else if (current.id !== undefined && !samePrices(current.patch, patch)) {
        await this.request("update price override", "PUT", `/api/governance/pricing-overrides/${encodeURIComponent(current.id)}`, Ignored, { patch });
      }
    }
  }

  private async request<T>(action: string, method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    let response: Response;
    try {
      const headers: Record<string, string> = { authorization: this.authorization };
      const init: RequestInit = { method, headers, signal: AbortSignal.timeout(30_000) };
      if (body !== undefined) {
        headers["content-type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      response = await fetch(new URL(path, this.settings.adminUrl), init);
    } catch (error: unknown) {
      throw new UpstreamError("bifrost", `${action} failed: unreachable`, undefined, { cause: error });
    }
    // Never the body: Bifrost's errors may echo what we sent.
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError("bifrost", `${action} failed (HTTP ${String(response.status)})`, response.status);
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text === "" ? undefined : JSON.parse(text);
    } catch {
      throw new UpstreamError("bifrost", `${action}: unreadable response`, response.status);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new UpstreamError("bifrost", `${action}: unexpected response`, response.status);
    return parsed.data;
  }
}

function storedPatch(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/** Whether Bifrost's stored patch holds exactly the pinned prices. */
function samePrices(stored: unknown, wanted: PricePatch): boolean {
  const parsed = StoredPatch.safeParse(stored);
  if (!parsed.success) return false;
  const set = Object.entries(parsed.data).filter(([, value]) => value !== null && value !== undefined);
  return set.length === Object.keys(wanted).length && set.every(([field, value]) => wanted[field] === value);
}
