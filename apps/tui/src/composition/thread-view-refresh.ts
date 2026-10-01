import type { Event, ThreadId } from "@dltech/atlas-core";
import {
  EChannelConnection,
  RemoteTurnRunner,
  transcriptIdentityDigest,
  type RemoteDeltaChannel,
  type TurnSpend,
} from "@dltech/atlas-harness";

import type { ConversationStore } from "../store";
import type { LogAccumulator, ToolEffects } from "../store/log-accumulator";
import type { AtlasApp } from "./compose";
import type { EThreadRows, ThreadSeed } from "./use-thread-view";
import {
  mergeWindowEvents,
  readThreadBase,
  readThreadSnapshot,
  readThreadWindow,
  retainNewest,
  type ThreadIdentity,
  type ThreadSnapshot,
} from "./thread-reads";
import { readThreadSpend } from "./thread-spend";
import { cloudReadinessOf } from "./cloud/cloud-readiness";

export const sameIdentity = (args: {
  left: ThreadIdentity | undefined;
  right: ThreadIdentity | undefined;
}): boolean =>
  args.left !== undefined &&
  args.right !== undefined &&
  args.left.head === args.right.head &&
  args.left.count === args.right.count &&
  args.left.digest === args.right.digest;

/**
 * A live durable refresh of a cloud transcript: one authoritative full snapshot replaces the
 * projection wholesale. Window merging is a local-log shortcut — on a cloud thread it cannot
 * hear a compaction's same-head rewrite, where the digest is the only durable signal that the
 * prefix changed, so identity equal means stand pat and anything else means reset. The register
 * lands after the store holds the snapshot, so a waiter on `waitUntilApplied` observes the
 * applied view, never the read that preceded it.
 */
export async function refreshCloudThreadView(args: {
  threadId: ThreadId;
  channel: RemoteDeltaChannel;
  readSnapshot: () => Promise<ThreadSnapshot>;
  readSpend: () => Promise<{ turns: readonly TurnSpend[] }>;
  readiness: CloudTranscriptReadiness;
  heldIdentity: () => ThreadIdentity | undefined;
  markApplied: (identity: ThreadIdentity) => void;
  resetLog: (next: {
    events: readonly Event[];
    base: LogAccumulator;
    turns: readonly TurnSpend[];
  }) => void;
  setEvents: (next: readonly Event[]) => void;
}): Promise<void> {
  const [snapshot, spent] = await Promise.all([args.readSnapshot(), args.readSpend()]);
  if (sameIdentity({ left: snapshot.identity, right: args.heldIdentity() })) return;

  const retained = retainNewest({ events: snapshot.events });
  args.resetLog({ events: retained, base: snapshot.base, turns: spent.turns });
  args.setEvents(retained);
  args.markApplied(snapshot.identity);
  args.readiness.registerApplied(snapshot.identity, Date.now());
}

type CloudTranscriptReadiness = ReturnType<typeof cloudReadinessOf>;

/**
 * Signals pile up while a cloud read is over the wire. One refresh runs at a time and the
 * callers that arrive during it collapse into a single trailing run, which reads after the
 * first finished — so reads never overlap and an older snapshot can never overwrite a newer one.
 */
export function createCloudRefresh(args: {
  run: () => Promise<void>;
}): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued = false;

  return (): Promise<void> => {
    if (inFlight !== null) {
      queued = true;
      return inFlight;
    }

    const step = async (): Promise<void> => {
      do {
        queued = false;
        await args.run();
      } while (queued);
    };

    inFlight = step().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export type ThreadViewRefresh = {
  refresh: () => Promise<void>;
  /** False while a cloud channel is Closed: a re-read then can never land, so signals stand down. */
  refreshable: () => boolean;
  gapped: () => boolean;
  markGapped: (next: boolean) => void;
  /**
   * Registers the seed identity the view was opened with. Called from a layout effect, after the
   * store built around the seed is the one on screen — a render-time write would run even for a
   * tree that never commits, and a passive effect would race a `waitUntilApplied` that can
   * resolve before passive effects run.
   */
  registerSeedIdentity: () => void;
};

/**
 * The refresh a thread view runs when the log moves. A local thread merges the tail window into
 * what it holds and re-reads the folded base only on a rewind; a cloud thread (remote runner)
 * takes the authoritative full snapshot instead, because the digest is the only signal that
 * hears a same-head rewrite. Both share the gap marker the pager pages against.
 */
export function createThreadViewRefresh(args: {
  app: AtlasApp;
  threadId: ThreadId;
  rows: EThreadRows;
  effects: ToolEffects;
  store: ConversationStore;
  setEvents: (next: readonly Event[]) => void;
  heldEvents: () => readonly Event[];
  readSeed: (() => ThreadSeed) | undefined;
}): ThreadViewRefresh {
  const { app, threadId, rows, effects, store, setEvents, heldEvents, readSeed } = args;
  let tailGapped = false;
  let baseSeeded = readSeed?.().base !== undefined;
  let lastHead: number | undefined;
  let heldIdentity = readSeed?.().identity;

  const cloudChannel: RemoteDeltaChannel | null =
    app.runner instanceof RemoteTurnRunner && "connection" in app.channel
      ? (app.channel as RemoteDeltaChannel)
      : null;
  const readiness = cloudChannel === null ? null : cloudReadinessOf(cloudChannel);

  const localRefresh = async (): Promise<void> => {
    const [window, spent] = await Promise.all([
      readThreadWindow({ log: app.log, threadId, rows }),
      readThreadSpend({ ledger: app.ledger, threadId }),
    ]);
    const rewound = lastHead !== undefined && window.head < lastHead;
    lastHead = window.head;

    if (baseSeeded && !rewound) {
      const merged = mergeWindowEvents({ held: heldEvents(), window: window.events });
      if (merged === null && tailGapped) return;

      tailGapped = false;
      const next = retainNewest({ events: merged ?? window.events });
      store.setEvents({ events: next, turns: spent.turns });
      setEvents(next);
      return;
    }

    tailGapped = false;
    const base = await readThreadBase({
      log: app.log,
      threadId,
      rows,
      fromSeq: window.fromSeq,
      effects,
    });
    baseSeeded = true;
    store.resetLog({ events: window.events, base, turns: spent.turns });
    setEvents(window.events);
  };

  const refresh =
    readiness === null || cloudChannel === null
      ? localRefresh
      : createCloudRefresh({
          run: () =>
            refreshCloudThreadView({
              threadId,
              channel: cloudChannel,
              readSnapshot: () =>
                readThreadSnapshot({
                  log: app.log,
                  threadId,
                  rows,
                  effects,
                  digest: transcriptIdentityDigest,
                }),
              readSpend: () => readThreadSpend({ ledger: app.ledger, threadId }),
              readiness,
              heldIdentity: () => heldIdentity,
              markApplied: (identity) => {
                heldIdentity = identity;
              },
              resetLog: (next) => {
                tailGapped = false;
                store.resetLog(next);
              },
              setEvents,
            }),
        });

  return {
    refresh,
    refreshable: () =>
      cloudChannel === null ||
      cloudChannel.connection().state !== EChannelConnection.Closed,
    gapped: () => tailGapped,
    markGapped: (next) => {
      tailGapped = next;
    },
    registerSeedIdentity: () => {
      if (readiness === null) return;
      const seeded = readSeed?.().identity;
      if (seeded === undefined) return;
      if (sameIdentity({ left: readiness.applied()?.identity, right: seeded })) return;

      heldIdentity = seeded;
      readiness.registerApplied(seeded, Date.now());
    },
  };
}
