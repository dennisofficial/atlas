import type { Event, EventLogPort, ThreadId } from "@dltech/atlas-core";

import { foldLogEvents, type LogAccumulator, type ToolEffects } from "../store/log-accumulator";
import { EThreadRows } from "./use-thread-view";

export const THREAD_WINDOW_EVENTS = 1500;

export type ThreadWindow = {
  events: readonly Event[];
  head: number;
  fromSeq: number;
};

const readFrom = (args: {
  log: EventLogPort;
  threadId: ThreadId;
  rows: EThreadRows;
  fromSeq?: number;
  upTo?: number;
}): Promise<readonly Event[]> =>
  args.rows === EThreadRows.Own
    ? args.log.readOwn({
        threadId: args.threadId,
        ...(args.fromSeq === undefined ? {} : { fromSeq: args.fromSeq }),
        ...(args.upTo === undefined ? {} : { upTo: args.upTo }),
      })
    : args.log.read({
        threadId: args.threadId,
        ...(args.fromSeq === undefined ? {} : { fromSeq: args.fromSeq }),
        ...(args.upTo === undefined ? {} : { upTo: args.upTo }),
      });

export async function readThreadWindow(args: {
  log: EventLogPort;
  threadId: ThreadId;
  rows: EThreadRows;
}): Promise<ThreadWindow> {
  const head = await args.log.head({ threadId: args.threadId });
  const fromSeq = Math.max(0, head - THREAD_WINDOW_EVENTS);
  const events = await readFrom({ ...args, fromSeq });
  return { events, head, fromSeq };
}

export async function readThreadBase(args: {
  log: EventLogPort;
  threadId: ThreadId;
  rows: EThreadRows;
  fromSeq: number;
  effects: ToolEffects;
}): Promise<LogAccumulator> {
  if (args.fromSeq === 0) return foldLogEvents({ events: [], effects: args.effects });

  const prefix = await readFrom({ ...args, upTo: args.fromSeq });
  return foldLogEvents({ events: prefix, effects: args.effects });
}
