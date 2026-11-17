import { readFileSync } from "node:fs";
import { z } from "zod";

const UsdPerToken = z.number().nonnegative().max(0.01);

/** `PRICES_FILE`: USD per token for each model a run may use. */
export const PriceFile = z.record(
  z.string().min(1),
  z.strictObject({
    input: UsdPerToken,
    output: UsdPerToken,
    cacheRead: UsdPerToken.optional(),
    cacheWrite: UsdPerToken.optional(),
  }),
);
export type PriceFile = z.infer<typeof PriceFile>;

/** Bifrost's pricing override fields. */
export type PricePatch = Readonly<Record<string, number>>;

/**
 * The pinned prices. Bifrost charges a model it has no price for $0, and a budget would then never
 * stop it: such a model is refused before any key is minted.
 */
export class PriceList {
  constructor(private readonly prices: PriceFile) {}

  static fromFile(path: string): PriceList {
    return new PriceList(PriceFile.parse(JSON.parse(readFileSync(path, "utf8"))));
  }

  unpriced(models: readonly string[]): string[] {
    return models.filter((model) => !Object.hasOwn(this.prices, model));
  }

  patch(model: string): PricePatch | undefined {
    const price = Object.hasOwn(this.prices, model) ? this.prices[model] : undefined;
    if (price === undefined) return undefined;
    return {
      input_cost_per_token: price.input,
      output_cost_per_token: price.output,
      ...(price.cacheRead === undefined ? {} : { cache_read_input_token_cost: price.cacheRead }),
      ...(price.cacheWrite === undefined ? {} : { cache_creation_input_token_cost: price.cacheWrite }),
    };
  }
}
