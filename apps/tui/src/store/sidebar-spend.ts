import {
  estimateCostUsd,
  type ModelCost,
  type ModelRef,
} from "@dltech/atlas-core";
import {
  NOTHING_SPENT,
  totalSpend,
  type SpendTotals,
  type TurnSpend,
} from "@dltech/atlas-harness";

import { formatTokens, theme } from "../ui/theme";
import type { LiveInput } from "../ui/turn-clock";

export type ModelPriceLookup = (ref: ModelRef) => ModelCost | undefined;

/**
 * What the conversation has cost so far. The ledger only gains a row once a turn has ended, so the
 * turn in flight contributes what its clock has counted: the output estimate, plus the input and
 * cache figures each finished step has already reported.
 *
 * `costUsd` is null when nothing could be priced — a subscription-credential provider ships no
 * rates, and a figure of zero would read as a free conversation rather than an unpriced one.
 */
export type SidebarSpend = {
  totals: SpendTotals;
  costUsd: number | null;
};

export const NOTHING_TALLIED: SidebarSpend = {
  totals: NOTHING_SPENT,
  costUsd: null,
};

function costOfTurns(args: {
  turns: readonly TurnSpend[];
  priceOf: ModelPriceLookup;
}): number | null {
  let dollars: number | null = null;

  for (const turn of args.turns) {
    const cost = args.priceOf({
      providerId: turn.providerId,
      modelId: turn.modelId,
    });
    if (cost === undefined) continue;

    dollars = (dollars ?? 0) + estimateCostUsd({ spend: turn, cost });
  }

  return dollars;
}

export function sidebarSpendOf(args: {
  turns: readonly TurnSpend[];
  liveOutputTokens: number;
  liveInput?: LiveInput | undefined;
  priceOf?: ModelPriceLookup | undefined;
}): SidebarSpend {
  const ledger = totalSpend(args.turns);
  const live = args.liveInput;
  const totals: SpendTotals = {
    ...ledger,
    inputTokens: ledger.inputTokens + (live?.inputTokens ?? 0),
    cacheReadTokens: ledger.cacheReadTokens + (live?.cacheReadTokens ?? 0),
    cacheWriteTokens: ledger.cacheWriteTokens + (live?.cacheWriteTokens ?? 0),
    outputTokens: ledger.outputTokens + args.liveOutputTokens,
  };

  return {
    totals,
    costUsd:
      args.priceOf === undefined
        ? null
        : costOfTurns({ ...args, priceOf: args.priceOf }),
  };
}

export const COST_WARN_USD = 50;

export const COST_DANGER_USD = 150;

export function costTone(costUsd: number): string {
  if (costUsd >= COST_DANGER_USD) return theme.error;
  if (costUsd >= COST_WARN_USD) return theme.warn;
  return theme.hint;
}

const CENT = 0.01;

export const formatUsd = (dollars: number): string =>
  dollars > 0 && dollars < CENT
    ? `<$${CENT.toFixed(2)}`
    : `$${dollars.toFixed(2)}`;

const FIGURE_SEPARATOR = "  ";

/**
 * Providers count cache reads inside `inputTokens` and bill them at a tenth of it, so the input
 * figure shows only the uncached remainder and the cache column carries the rest. Read together
 * they are the true input total, and a long conversation shows its caching is working rather than
 * reading as many millions of fresh tokens.
 */
export function spendFigures(spend: SidebarSpend): string | null {
  const { inputTokens, outputTokens, cacheReadTokens } = spend.totals;
  if (inputTokens === 0 && outputTokens === 0) return null;

  const figures = [
    `↑ ${formatTokens(inputTokens - cacheReadTokens)}`,
    `↓ ${formatTokens(outputTokens)}`,
    ...(cacheReadTokens === 0
      ? []
      : [`cache ${formatTokens(cacheReadTokens)}`]),
  ];

  return figures.join(FIGURE_SEPARATOR);
}
