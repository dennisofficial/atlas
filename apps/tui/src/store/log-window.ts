import type { Event } from "@dltech/atlas-core";

import {
  cloneLogAccumulator,
  emptyLogAccumulator,
  foldLogEvent,
  type LogAccumulator,
  type ToolEffects,
} from "./log-accumulator";

export type LogSummary = Pick<
  LogAccumulator,
  "opening" | "tokens" | "treeMutations" | "worktree" | "home" | "repo"
>;

export type LogWindow = {
  readonly acc: LogAccumulator;
  seed(args: { events: readonly Event[]; base?: LogAccumulator | undefined }): void;
  advance(args: { events: readonly Event[] }): void;
  reset(args: { events: readonly Event[]; base: LogAccumulator }): void;
};

/**
 * The whole-thread fold without the whole thread: the base covers everything before the window the
 * view first handed over, and every event since lands exactly once, tracked by sequence. Demand-loaded
 * older events need no folding — the base already covered them the moment the window was seeded.
 */
export function createLogWindow(args: { effects: ToolEffects }): LogWindow {
  let acc = emptyLogAccumulator();
  let maxSeenSeq = 0;

  const fold = (events: readonly Event[]): void => {
    for (const event of events) {
      if (event.seq <= maxSeenSeq) continue;
      foldLogEvent({ acc, event, effects: args.effects });
      maxSeenSeq = event.seq;
    }
  };

  return {
    get acc() {
      return acc;
    },

    seed({ events, base }) {
      acc = base === undefined ? emptyLogAccumulator() : cloneLogAccumulator(base);
      maxSeenSeq = 0;
      fold(events);
    },

    advance({ events }) {
      fold(events);
    },

    reset({ events, base }) {
      acc = cloneLogAccumulator(base);
      maxSeenSeq = 0;
      fold(events);
    },
  };
}
