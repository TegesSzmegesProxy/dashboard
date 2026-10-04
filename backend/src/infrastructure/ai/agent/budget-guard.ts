import { addUsage, EMPTY_USAGE, PriceTable, TokenUsage } from '../pricing.js';

/**
 * Enforced spend ceiling for one analysis (ADR-0011). Checked after every
 * model response; nothing a model says can raise it.
 */
export class BudgetGuard {
  private spent: number;
  private usage: TokenUsage;

  constructor(
    private readonly prices: PriceTable,
    readonly ceilingUsd: number,
    alreadySpentUsd = 0,
    alreadyUsed: TokenUsage = EMPTY_USAGE,
  ) {
    this.spent = alreadySpentUsd;
    this.usage = alreadyUsed;
  }

  get spentUsd(): number {
    return this.spent;
  }

  get totalUsage(): TokenUsage {
    return this.usage;
  }

  get exhausted(): boolean {
    return this.spent >= this.ceilingUsd;
  }

  /** Records one response and returns its cost in USD. */
  record(usage: TokenUsage, ...models: string[]): number {
    const cost = this.prices.costUsd(usage, ...models);
    this.spent += cost;
    this.usage = addUsage(this.usage, usage);
    return cost;
  }

  /** Remaining USD, never negative. */
  get remainingUsd(): number {
    return Math.max(0, this.ceilingUsd - this.spent);
  }
}
