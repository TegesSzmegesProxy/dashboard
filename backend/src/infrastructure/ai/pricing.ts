/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/** List prices (2026-09); override with `AI_PRICE_TABLE`. */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': {
    input: 10,
    output: 50,
    cacheWrite: 12.5,
    cacheRead: 0.25,
  },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheWrite: 2.5,
    cacheRead: 0.2,
  },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export class PriceTable {
  private readonly prices: Record<string, ModelPrice>;
  private readonly mostExpensive: ModelPrice;

  constructor(overridesJson?: string) {
    this.prices = { ...DEFAULT_PRICES, ...PriceTable.parse(overridesJson) };
    this.mostExpensive = Object.values(this.prices).reduce((max, price) =>
      price.output > max.output ? price : max,
    );
  }

  /** Unknown models are charged at the most expensive known price. */
  price(model: string): ModelPrice {
    return this.prices[model] ?? this.mostExpensive;
  }

  costUsd(usage: TokenUsage, ...models: string[]): number {
    const price = models
      .map((model) => this.price(model))
      .reduce((max, current) => (current.output > max.output ? current : max));
    return (
      (usage.inputTokens * price.input +
        usage.outputTokens * price.output +
        usage.cacheWriteTokens * price.cacheWrite +
        usage.cacheReadTokens * price.cacheRead) /
      1_000_000
    );
  }

  private static parse(json?: string): Record<string, ModelPrice> {
    if (!json) return {};
    const parsed = JSON.parse(json) as Record<string, Partial<ModelPrice>>;
    const result: Record<string, ModelPrice> = {};
    for (const [model, price] of Object.entries(parsed)) {
      const values = [
        price.input,
        price.output,
        price.cacheWrite,
        price.cacheRead,
      ];
      if (values.some((value) => typeof value !== 'number' || value < 0)) {
        throw new Error(`AI_PRICE_TABLE entry for ${model} is invalid`);
      }
      result[model] = price as ModelPrice;
    }
    return result;
  }
}
