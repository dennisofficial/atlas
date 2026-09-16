import type { ModelCost } from "./card";

const PER_MILLION = 1_000_000;

/**
 * Cards that publish no cache rates fall back to the shape Anthropic and OpenAI share: a cache
 * read at 0.1× the input rate and a five-minute cache write at 1.25×. The write multiplier
 * over-states OpenAI, which charges nothing to write — the direction an estimate should err in.
 * https://docs.claude.com/en/docs/build-with-claude/prompt-caching#pricing
 * https://platform.openai.com/docs/guides/prompt-caching
 */
const FALLBACK_CACHE_READ_RATE = 0.1;

const FALLBACK_CACHE_WRITE_RATE = 1.25;

export type TokenSpend = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/**
 * Cache reads and writes are counted inside `inputTokens` rather than on top of it, so the tokens
 * billed at the plain input rate are what is left once both are taken out.
 */
export function estimateCostUsd(args: {
  spend: TokenSpend;
  cost: ModelCost;
}): number {
  const { spend, cost } = args;

  const readPerMillion =
    cost.cacheReadPerMillion ?? cost.inputPerMillion * FALLBACK_CACHE_READ_RATE;
  const writePerMillion =
    cost.cacheWritePerMillion ?? cost.inputPerMillion * FALLBACK_CACHE_WRITE_RATE;

  const uncached = Math.max(
    0,
    spend.inputTokens - spend.cacheReadTokens - spend.cacheWriteTokens,
  );

  const dollars =
    uncached * cost.inputPerMillion +
    spend.cacheReadTokens * readPerMillion +
    spend.cacheWriteTokens * writePerMillion +
    spend.outputTokens * cost.outputPerMillion;

  return dollars / PER_MILLION;
}
