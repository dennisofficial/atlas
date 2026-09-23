import type { CallId, ThreadId, Event } from "@dltech/atlas-core";
import type {
  ChannelSignal,
  DeltaChannel,
  TurnSpend,
  Unsubscribe,
} from "@dltech/atlas-harness";

import { IDLE_TURN, type TurnClock } from "../ui/turn-clock";
import { assembleTranscript } from "./derive-transcript";
import { durableEntries } from "./durable-entries";
import type { LogAccumulator, ToolEffects } from "./log-accumulator";
import { createLogWindow, type LogSummary } from "./log-window";
import {
  advancedGate,
  attachedGate,
  FRAME_MS,
  gateIsDraining,
  type RevealGate,
} from "./reveal";
import {
  sameSidebar,
  sidebarFoldFrom,
  sidebarFrom,
  type SidebarContainer,
  type SidebarModel,
} from "./sidebar-model";
import { watchSandbox, type SandboxStatusSource } from "./sandbox-source";
import { pendingTldrOf, subscribeTldrFeed } from "../ui/tldr-feed-store";
import { sameEvents, sameTurns } from "./same-log";
import type { ModelPriceLookup } from "./sidebar-spend";
import { stabilisedEntries } from "./stable-entries";
import { createStepTracker } from "./step-tracker";
import { SHIPPED_THINKING, type EThinkingVisibility } from "./thinking-fold";
import type {
  StepFailure,
  TranscriptEntry,
  TranscriptModel,
} from "./transcript-model";
import { IDLE_PROGRESS, turnObserved, type TurnProgress } from "./turn-progress";

export type ConversationStore = {
  subscribe(listener: () => void): Unsubscribe
  getSnapshot(): TranscriptModel
  getSidebar(): SidebarModel
  getTurn(): TurnClock
  getLogSummary(): LogSummary
  setEvents(args: { events: readonly Event[]; turns?: readonly TurnSpend[] | undefined }): void
  resetLog(args: {
    events: readonly Event[]
    base: LogAccumulator
    turns?: readonly TurnSpend[] | undefined
  }): void
  stampTurn(advance: (progress: TurnProgress) => TurnProgress): void
  supersedeFailure(): void
  resetSteps(): void
  setThinking(thinking: EThinkingVisibility): void
  setTldrStatus(tldrStatus: boolean): void
  setName(name: string | null): void
  dispose(): void
}

const NO_TURNS: readonly TurnSpend[] = Object.freeze([])

/** A running command's panel reads only its freshest lines, so the tail itself stays shallow. */
const MAX_TAIL_CHARACTERS = 60_000;

export function createConversationStore(args: {
  channel: DeltaChannel;
  threadId: ThreadId;
  events?: readonly Event[];
  turns?: readonly TurnSpend[];
  base?: LogAccumulator;
  effects?: ToolEffects;
  paceReveal?: boolean;
  thinking?: EThinkingVisibility;
  name?: string | null;
  priceOf?: ModelPriceLookup | undefined;
  projectEvents?: ((args: { events: readonly Event[] }) => void) | undefined;
  sandbox?: SandboxStatusSource | undefined;
  readClock?: (() => number) | undefined;
}): ConversationStore {
  const paceReveal = args.paceReveal ?? false;
  const readClock = args.readClock ?? Date.now;
  let thinking: EThinkingVisibility = args.thinking ?? SHIPPED_THINKING;
  let tldrStatus = true;
  let name: string | null = args.name ?? null;
  let events: readonly Event[] = args.events ?? [];
  let turns: readonly TurnSpend[] = args.turns ?? NO_TURNS;
  let progress: TurnProgress = IDLE_PROGRESS;
  let turn: TurnClock = IDLE_TURN;
  let gate: RevealGate | null = null;
  let sandbox: SidebarContainer | null = args.sandbox?.current() ?? null;
  let pendingTldr = pendingTldrOf(args.threadId) ?? null;
  let frame: ReturnType<typeof setTimeout> | undefined;
  let queuedRepaint: ReturnType<typeof setTimeout> | undefined;
  const tracker = createStepTracker();
  const tails = new Map<CallId, string>();
  let durable: {
    events: readonly Event[];
    turns: readonly TurnSpend[];
    entries: TranscriptEntry[];
  } | null = null;
  let projected: readonly Event[] | null = null;

  const logWindow = createLogWindow({ effects: args.effects ?? (() => undefined) });
  logWindow.seed({ events, ...(args.base === undefined ? {} : { base: args.base }) });

  const durableNow = (): readonly TranscriptEntry[] => {
    if (durable !== null && durable.events === events && durable.turns === turns) {
      return durable.entries;
    }

    const entries = durableEntries({ events, turns });
    durable = { events, turns, entries };
    return entries;
  };

  const sidebarNow = (): SidebarModel =>
    sidebarFrom({ fold: sidebarFoldFrom(logWindow.acc), turn, turns, priceOf: args.priceOf, name });

  let model = assembleTranscript({ durable: durableNow(), live: [], thinking, pendingTldr, tldrStatus, sandbox })
  let sidebar = sidebarNow()

  args.projectEvents?.({ events });
  projected = events;

  const listeners = new Set<() => void>();

  const wake = () => {
    for (const listener of [...listeners]) listener();
  };

  const sameFailure = (left: StepFailure | null, right: StepFailure | null): boolean =>
    left === right || (left !== null && right !== null && left.message === right.message);

  const settled = (derived: TranscriptModel): TranscriptModel => {
    const entries = stabilisedEntries({
      previous: model.entries,
      next: derived.entries,
    });
    const unchanged =
      entries === model.entries &&
      derived.isEmpty === model.isEmpty &&
      derived.streaming === model.streaming &&
      sameFailure(derived.failure, model.failure);

    return unchanged ? model : { ...derived, entries };
  };

  const pruneTails = () => {
    if (tails.size === 0) return;

    const called = new Set<CallId>();
    const settledIds = new Set<CallId>();
    for (const event of events) {
      if (event.type === "tool-called") called.add(event.callId);
      if (event.type === "tool-result" || event.type === "tool-denied") {
        settledIds.add(event.callId);
      }
    }

    for (const callId of [...tails.keys()]) {
      if (settledIds.has(callId) || !called.has(callId)) tails.delete(callId);
    }
  };

  const republish = () => {
    turn = progress.clock;
    tracker.pruneSuperseded(events);
    pruneTails();
    model = settled(
      assembleTranscript({
        durable: durableNow(),
        live: tracker.live(events),
        reveal: gate,
        thinking,
        pendingTldr,
        tldrStatus,
        sandbox,
        outputs: tails,
      }),
    )
    const nextSidebar = sidebarNow()
    if (!sameSidebar(sidebar, nextSidebar)) sidebar = nextSidebar
    if (projected !== events) {
      args.projectEvents?.({ events });
      projected = events;
    }
    wake();
  };

  const scheduleFrame = () => {
    if (frame !== undefined) return;

    frame = setTimeout(() => {
      frame = undefined;
      const tail = tracker.tailRun(events);
      gate = advancedGate({ gate, tail });
      republish();
      if (gateIsDraining({ gate, tail })) scheduleFrame();
    }, FRAME_MS);
  };

  const scheduleRepaint = () => {
    if (queuedRepaint !== undefined) return;

    queuedRepaint = setTimeout(() => {
      queuedRepaint = undefined;
      republish();
    }, FRAME_MS);
  };

  const repaintNow = () => {
    if (queuedRepaint !== undefined) {
      clearTimeout(queuedRepaint);
      queuedRepaint = undefined;
    }
    republish();
  };

  const handleSignal = (signal: ChannelSignal) => {
    progress = turnObserved({ progress, signal, now: readClock() });

    if (signal.type === "events-appended" || signal.type === "retry-cleared") return;
    if (signal.type === "retry-waiting") {
      republish();
      return;
    }

    if (signal.type === "tool-output") {
      tails.set(
        signal.callId,
        ((tails.get(signal.callId) ?? "") + signal.text).slice(-MAX_TAIL_CHARACTERS),
      );
      scheduleRepaint();
      return;
    }

    tracker.absorb(signal);

    if (paceReveal && signal.type === "chunk") {
      gate = attachedGate({ gate, tail: tracker.tailRun(events) });
      scheduleFrame();
      return;
    }

    if (signal.type === "chunk") {
      scheduleRepaint();
      return;
    }

    gate = null;
    repaintNow();
  };

  let unsubscribeFromChannel: Unsubscribe | undefined = args.channel.subscribe({
    threadId: args.threadId,
    listener: handleSignal,
  });

  const unsubscribeFromFeed = subscribeTldrFeed(() => {
    const next = pendingTldrOf(args.threadId) ?? null;
    if (next === null && pendingTldr === null) return;
    if (
      next !== null &&
      pendingTldr !== null &&
      next.anchorSeq === pendingTldr.anchorSeq &&
      next.text === pendingTldr.text
    ) {
      return;
    }
    pendingTldr = next;
    republish();
  });

  const unsubscribeFromSandbox = watchSandbox({
    source: args.sandbox,
    current: () => sandbox,
    onMoved: (next) => {
      sandbox = next;
      republish();
    },
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    getSnapshot: () => model,

    getSidebar: () => sidebar,

    getTurn: () => turn,

    setEvents(next) {
      const logMoved = !sameEvents({ left: events, right: next.events });
      const spendMoved =
        next.turns !== undefined && !sameTurns({ left: turns, right: next.turns });
      if (!logMoved && !spendMoved) return;

      if (logMoved) logWindow.advance({ events: next.events });
      events = next.events;
      if (next.turns !== undefined) turns = next.turns;
      republish();
    },

    resetLog(next) {
      logWindow.reset({ events: next.events, base: next.base });
      events = next.events;
      if (next.turns !== undefined) turns = next.turns;
      republish();
    },

    getLogSummary() {
      const { opening, tokens, treeMutations, worktree, home, repo } = logWindow.acc;
      return { opening, tokens, treeMutations, worktree, home, repo, windowStartSeq: events[0]?.seq ?? 0 };
    },

    stampTurn(advance) {
      const next = advance(progress);
      const clockMoved = next.clock !== progress.clock;
      progress = next;
      if (clockMoved) republish();
    },

    supersedeFailure() {
      if (!tracker.dropFailedTail(events)) return;

      republish();
    },

    resetSteps() {
      tracker.reset()
      tails.clear()
      republish()
    },

    setThinking(next) {
      if (next === thinking) return;
      thinking = next;
      republish();
    },

    setTldrStatus(next) {
      if (next === tldrStatus) return;
      tldrStatus = next;
      republish();
    },

    setName(next) {
      if (next === name) return;
      name = next;
      republish();
    },

    dispose() {
      if (frame !== undefined) clearTimeout(frame);
      frame = undefined;
      if (queuedRepaint !== undefined) clearTimeout(queuedRepaint);
      queuedRepaint = undefined;
      unsubscribeFromChannel?.();
      unsubscribeFromChannel = undefined;
      unsubscribeFromFeed();
      unsubscribeFromSandbox?.();
      listeners.clear();
    },
  };
}
