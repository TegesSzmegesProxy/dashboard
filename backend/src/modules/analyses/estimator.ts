import type { PriceTable } from '../../infrastructure/ai/pricing.js';
import type { AnalysisEstimate, RangeEstimate } from './analysis.types.js';

/** Rough tokens per byte of source code. */
const TOKENS_PER_BYTE = 1 / 3.5;
/** System prompt, tool schemas, dossier and environment block. */
const PREFIX_TOKENS = 14_000;
const ITEM_READ_CAP_TOKENS = 30_000;

interface Profile {
  turns: number;
  /** Tokens of source the agent reads, beyond the candidate's own file. */
  extraReadTokens: number;
  outputPerTurn: number;
  readFactor: number;
}

const PROFILES: Record<'low' | 'expected' | 'high', Profile> = {
  low: {
    turns: 5,
    extraReadTokens: 3_000,
    outputPerTurn: 600,
    readFactor: 0.6,
  },
  expected: {
    turns: 9,
    extraReadTokens: 8_000,
    outputPerTurn: 1_200,
    readFactor: 1,
  },
  high: {
    turns: 16,
    extraReadTokens: 16_000,
    outputPerTurn: 2_000,
    readFactor: 1.6,
  },
};

export interface EstimateInput {
  model: string;
  strongCandidates: number;
  heuristicOnlyCandidates: number;
  /** Bytes of the files where candidates were found, one entry per candidate. */
  candidateFileBytes: number[];
  routeLikeFiles: number;
  maxWorkItems: number;
  aiCredentialConfigured: boolean;
}

/**
 * Index-only cost estimate (ADR-0015). It models each agent run as a
 * conversation whose prefix is read from cache every turn and whose
 * transcript grows with what the agent reads. Calibrate with recorded usage.
 */
export function estimateAnalysis(
  input: EstimateInput,
  prices: PriceTable,
): AnalysisEstimate {
  const price = prices.price(input.model);
  const averageFileTokens =
    input.candidateFileBytes.length > 0
      ? Math.min(
          ITEM_READ_CAP_TOKENS,
          (input.candidateFileBytes.reduce((sum, bytes) => sum + bytes, 0) /
            input.candidateFileBytes.length) *
            TOKENS_PER_BYTE,
        )
      : 6_000;
  const items: RangeEstimate = {
    low: Math.min(
      input.maxWorkItems,
      Math.max(
        input.strongCandidates,
        Math.ceil(input.heuristicOnlyCandidates * 0.2),
      ),
    ),
    expected: Math.min(
      input.maxWorkItems,
      input.strongCandidates > 0
        ? input.strongCandidates +
            Math.ceil(input.heuristicOnlyCandidates * 0.2)
        : Math.ceil(input.heuristicOnlyCandidates * 0.6),
    ),
    high: Math.min(
      input.maxWorkItems,
      input.strongCandidates + input.heuristicOnlyCandidates,
    ),
  };

  const run = (profile: Profile, reads: number) => {
    const transcriptAverage =
      (reads * profile.readFactor) / 2 + profile.turns * 400;
    return {
      cacheRead: profile.turns * (PREFIX_TOKENS + transcriptAverage),
      cacheWrite: reads * profile.readFactor + PREFIX_TOKENS / 4,
      input: profile.turns * 300,
      output: profile.turns * profile.outputPerTurn + 2_500,
    };
  };

  const range = (level: 'low' | 'expected' | 'high') => {
    const profile = PROFILES[level];
    const item = run(profile, averageFileTokens + profile.extraReadTokens);
    const recon = run({ ...profile, turns: profile.turns * 2 }, 40_000);
    const sweep = run(profile, Math.min(60, input.routeLikeFiles) * 1_500);
    const total = (part: 'cacheRead' | 'cacheWrite' | 'input' | 'output') =>
      item[part] * items[level] + recon[part] + sweep[part];
    const inputTokens =
      total('cacheRead') + total('cacheWrite') + total('input');
    const outputTokens = total('output');
    const usd =
      (total('cacheRead') * price.cacheRead +
        total('cacheWrite') * price.cacheWrite +
        total('input') * price.input +
        outputTokens * price.output) /
      1_000_000;
    return { inputTokens, outputTokens, usd };
  };

  const low = range('low');
  const expected = range('expected');
  const high = range('high');
  const round = (value: number) => Math.round(value);
  const cents = (value: number) => Math.ceil(value * 100) / 100;
  return {
    model: input.model,
    workItems: items,
    inputTokens: {
      low: round(low.inputTokens),
      expected: round(expected.inputTokens),
      high: round(high.inputTokens),
    },
    outputTokens: {
      low: round(low.outputTokens),
      expected: round(expected.outputTokens),
      high: round(high.outputTokens),
    },
    usd: {
      low: cents(low.usd),
      expected: cents(expected.usd),
      high: cents(high.usd),
    },
    suggestedCeilingUsd: cents(high.usd),
    assumptions: [
      `${input.strongCandidates} candidates confirmed by specs or framework packs; ${input.heuristicOnlyCandidates} heuristic-only hits, of which recon rules and the sweep are expected to confirm a fraction.`,
      `Work items are capped at ${input.maxWorkItems}.`,
      `Each endpoint agent is assumed to take ${PROFILES.low.turns}-${PROFILES.high.turns} turns, with the shared prefix read from cache.`,
      'This is an approximation. The approved ceiling, not this estimate, limits spending; work left when it is reached stays visible as unresolved.',
    ],
    aiCredentialConfigured: input.aiCredentialConfigured,
  };
}
