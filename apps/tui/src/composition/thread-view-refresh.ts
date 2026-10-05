import type { Event, ThreadId } from "@dltech/atlas-core";
import {
  EChannelConnection,
  RemoteTurnRunner,
  transcriptIdentityDigest,
  type RemoteDeltaChannel,
  type TurnSpend,
} from "@dltech/atlas-harness";

import type { ConversationStore } from "../store";
import type { ToolEffects } from "../store/log-accumulator";
import type { AtlasApp } from "./compose";
import type { EThreadRows, ThreadSeed } from "./use-thread-view";
import {
  mergeWindowEvents,
  readThreadBase,
  readThreadSnapshot,
  readThreadWindow,
  retainNewest,
  type ThreadIdentity,
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

export const cloudChannelOf = (app: AtlasApp): RemoteDeltaChannel | null =>
  app.runner instanceof RemoteTurnRunner && "connection" in app.channel
    ? (app.channel as RemoteDeltaChannel)
    : null;

export const EXTERNAL_DRIVE_POLL_MS = 4000;

export function driveThreadViewExternally(args: {
  cloudChannel: RemoteDeltaChannel | null;
  viewRefresh: ThreadViewRefresh;
}): (() => void) | undefined {
  if (!args.viewRefresh.drivesExternally()) return undefined;
  if (args.cloudChannel === null) return undefined;

  const unready = args.cloudChannel.onReady(() => {
    void args.viewRefresh.refresh().catch(() => undefined);
  });
  const poll = setInterval(() => {
    if (!args.viewRefresh.refreshable()) return;
    void args.viewRefresh.refresh().catch(() => undefined);
  }, EXTERNAL_DRIVE_POLL_MS);
  poll.unref?.();

  return () => {
    unready();
    clearInterval(poll);
  };
}

export type ThreadViewRefresh = {
  refresh: () => Promise<void>;
  /** False while a cloud channel is Closed or Parked: a re-read then can never land, so signals stand down. */
  refreshable: () => boolean;
  /** True when the channel never carries this thread's signals (cloud, non-root), so the view drives its own refreshes. */
  drivesExternally: () => boolean;
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

  const cloudChannel = cloudChannelOf(app);
  // Readiness is one slot per channel, and that slot vouches for the root thread alone — a
  // parked session's record and the dim authority both read it as the root's. A child view
  // registering its own identity there would stand in the park's way, so children get none.
  const ownsChannelReadiness =
    cloudChannel !== null && threadId === cloudChannel.threadId;
  const readiness = ownsChannelReadiness ? cloudReadinessOf(cloudChannel!) : null;

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

  // A cloud thread reads one authoritative full snapshot and replaces the projection wholesale.
  // Window merging is a local-log shortcut — it cannot hear a compaction's same-head rewrite,
  // where the digest is the only durable signal that the prefix changed, so identity equal means
  // stand pat and anything else means reset. The register lands after the store holds the
  // snapshot, so a waiter on `waitUntilApplied` observes the applied view, never the read that
  // preceded it.
  const refresh =
    cloudChannel === null
      ? localRefresh
      : createCloudRefresh({
          run: async () => {
            const [snapshot, spent] = await Promise.all([
              readThreadSnapshot({
                log: app.log,
                threadId,
                rows,
                effects,
                digest: transcriptIdentityDigest,
              }),
              readThreadSpend({ ledger: app.ledger, threadId }),
            ]);
            if (sameIdentity({ left: snapshot.identity, right: heldIdentity })) return;

            const retained = retainNewest({ events: snapshot.events });
            tailGapped = false;
            store.resetLog({ events: retained, base: snapshot.base, turns: spent.turns });
            setEvents(retained);
            heldIdentity = snapshot.identity;
            if (readiness !== null) {
              readiness.registerApplied(snapshot.identity, Date.now(), snapshot.all);
            }
          },
        });

  return {
    refresh,
    refreshable: () =>
      cloudChannel === null ||
      (cloudChannel.connection().state !== EChannelConnection.Closed &&
        cloudChannel.connection().state !== EChannelConnection.Parked),
    drivesExternally: () =>
      cloudChannel !== null && threadId !== cloudChannel.threadId,
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
      readiness.registerApplied(seeded, Date.now(), readSeed?.().appliedEvents);
    },
  };
}
