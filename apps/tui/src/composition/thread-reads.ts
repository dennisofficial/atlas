import type { Event, EventLogPort, ThreadId } from "@dltech/atlas-core";

import { foldLogEvents, type LogAccumulator, type ToolEffects } from "../store/log-accumulator";
import { EThreadRows } from "./use-thread-view";

export const THREAD_WINDOW_EVENTS = 1500;

export const THREAD_RETENTION_EVENTS = THREAD_WINDOW_EVENTS * 2;

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

export async function readOlderEvents(args: {
  log: EventLogPort;
  threadId: ThreadId;
  rows: EThreadRows;
  beforeSeq: number;
}): Promise<readonly Event[]> {
  const upTo = args.beforeSeq - 1;
  const fromSeq = Math.max(0, upTo - THREAD_WINDOW_EVENTS);
  return readFrom({
    log: args.log,
    threadId: args.threadId,
    rows: args.rows,
    fromSeq,
    upTo,
  });
}

export async function readNewerEvents(args: {
  log: EventLogPort;
  threadId: ThreadId;
  rows: EThreadRows;
  afterSeq: number;
  head: number;
}): Promise<readonly Event[]> {
  const upTo = Math.min(args.head, args.afterSeq + THREAD_WINDOW_EVENTS);
  return readFrom({
    log: args.log,
    threadId: args.threadId,
    rows: args.rows,
    fromSeq: args.afterSeq,
    upTo,
  });
}

export function mergeWindowEvents(args: {
  held: readonly Event[];
  window: readonly Event[];
}): readonly Event[] | null {
  const anchor = args.window[0];
  if (anchor === undefined) return args.window;
  if (args.held[0] === anchor && args.held.length === args.window.length) return args.window;

  const at = args.held.findIndex((event) => event.id === anchor.id);
  if (at < 0) return null;
  if (at === 0) return args.window;
  return [...args.held.slice(0, at), ...args.window];
}

export function retainOldest(args: {
  events: readonly Event[];
  cap?: number;
}): { events: readonly Event[]; evictedTail: boolean } {
  const cap = args.cap ?? THREAD_RETENTION_EVENTS;
  if (args.events.length <= cap) return { events: args.events, evictedTail: false };
  return { events: args.events.slice(0, cap), evictedTail: true };
}

export function retainNewest(args: {
  events: readonly Event[];
  cap?: number;
}): readonly Event[] {
  const cap = args.cap ?? THREAD_RETENTION_EVENTS;
  if (args.events.length <= cap) return args.events;
  return args.events.slice(args.events.length - cap);
}

export type ThreadPager = {
  loadOlder(): Promise<void>;
  loadNewer(): Promise<void>;
};

export function createThreadPager(args: {
  log: EventLogPort;
  threadId: ThreadId;
  rows: EThreadRows;
  held: () => readonly Event[];
  gapped: () => boolean;
  markGapped: (next: boolean) => void;
  apply: (next: readonly Event[]) => void;
}): ThreadPager {
  let paging = false;

  const loadOlder = async (): Promise<void> => {
    const first = args.held()[0];
    if (first === undefined || first.seq <= 1 || paging) return;

    paging = true;
    try {
      const older = await readOlderEvents({
        log: args.log,
        threadId: args.threadId,
        rows: args.rows,
        beforeSeq: first.seq,
      });
      if (older.length === 0) return;

      const retained = retainOldest({ events: [...older, ...args.held()] });
      args.markGapped(args.gapped() || retained.evictedTail);
      args.apply(retained.events);
    } finally {
      paging = false;
    }
  };

  const loadNewer = async (): Promise<void> => {
    const last = args.held().at(-1);
    if (last === undefined || !args.gapped() || paging) return;

    paging = true;
    try {
      const head = await args.log.head({ threadId: args.threadId });
      if (last.seq >= head) {
        args.markGapped(false);
        return;
      }

      const newer = await readNewerEvents({
        log: args.log,
        threadId: args.threadId,
        rows: args.rows,
        afterSeq: last.seq,
        head,
      });
      if (newer.length === 0) return;

      args.markGapped((newer.at(-1)?.seq ?? head) < head);
      args.apply(retainNewest({ events: [...args.held(), ...newer] }));
    } finally {
      paging = false;
    }
  };

  return { loadOlder, loadNewer };
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
