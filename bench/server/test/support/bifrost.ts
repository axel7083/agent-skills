import { http, HttpResponse } from "msw";
import { setupServer, type SetupServer } from "msw/node";
import { z } from "zod";

const CreateBody = z.object({
  name: z.string(),
  budgets: z.array(z.object({ max_limit: z.number() })),
  provider_configs: z.array(z.object({ allowed_models: z.array(z.string()) })),
  expires_at: z.string(),
});
const UpdateBody = z.object({ is_active: z.boolean().optional() });
const OverrideBody = z.object({ pattern: z.string(), patch: z.unknown() });

export const BIFROST_ADMIN_URL = "http://bifrost-admin.test";

interface FakeKey {
  id: string;
  value: string;
  name: string;
  active: boolean;
  limitUsd: number;
  models: string[];
  usageUsd: number;
  usageTokens: number;
  expiresAt: string;
}

/** Bifrost's governance API, in memory: enough of it for the server's key lifecycle. */
export class FakeBifrost {
  readonly keys = new Map<string, FakeKey>();
  readonly overrides = new Map<string, { id: string; pattern: string; patch: unknown }>();
  readonly server: SetupServer;
  private next = 0;

  constructor() {
    const base = `${BIFROST_ADMIN_URL}/api/governance`;
    this.server = setupServer(
      http.post(`${base}/virtual-keys`, async ({ request }) => {
        const body = CreateBody.parse(await request.json());
        const id = `vk-${String(++this.next)}`;
        const key: FakeKey = {
          id,
          value: `sk-bf-00000000-0000-0000-0000-${String(this.next).padStart(12, "0")}`,
          name: body.name,
          active: true,
          limitUsd: body.budgets[0]?.max_limit ?? 0,
          models: body.provider_configs[0]?.allowed_models ?? [],
          usageUsd: 0,
          usageTokens: 0,
          expiresAt: body.expires_at,
        };
        this.keys.set(id, key);
        return HttpResponse.json({ virtual_key: { id, value: key.value } });
      }),
      http.put(`${base}/virtual-keys/:id`, async ({ params, request }) => {
        const key = this.keys.get(String(params["id"]));
        if (key === undefined) return new HttpResponse(null, { status: 404 });
        const body = UpdateBody.parse(await request.json());
        if (body.is_active === false) key.active = false;
        return HttpResponse.json({});
      }),
      http.get(`${base}/virtual-keys/:id`, ({ params }) => {
        const key = this.keys.get(String(params["id"]));
        if (key === undefined) return new HttpResponse(null, { status: 404 });
        return HttpResponse.json({ virtual_key: { budgets: [{ current_usage: key.usageUsd }], rate_limit: { token_current_usage: key.usageTokens } } });
      }),
      http.delete(`${base}/virtual-keys/:id`, ({ params }) => {
        return this.keys.delete(String(params["id"])) ? HttpResponse.json({}) : new HttpResponse(null, { status: 404 });
      }),
      http.get(`${base}/pricing-overrides`, () => HttpResponse.json({ pricing_overrides: this.overrides.size === 0 ? null : [...this.overrides.values()] })),
      http.post(`${base}/pricing-overrides`, async ({ request }) => {
        const body = OverrideBody.parse(await request.json());
        this.overrides.set(body.pattern, { id: `po-${body.pattern}`, pattern: body.pattern, patch: body.patch });
        return HttpResponse.json({});
      }),
    );
  }

  /** What the gateway saw for the key minted under `name`. */
  byName(name: string): FakeKey | undefined {
    return [...this.keys.values()].find((key) => key.name === name);
  }
}
