import type { Event } from '@dltech/atlas-core'
import type { ChannelSignal, TurnSpend, Unsubscribe } from '@dltech/atlas-harness'
import {
  assembleTranscript,
  persistedFailureOf,
  SHIPPED_THINKING,
  type EThinkingVisibility,
  type RevealGate,
  type TranscriptModel,
} from '@dltech/atlas-client/transcript'

import { IDLE_TURN, type TurnClock } from '../ui/turn-clock'
import type { ConversationStore, ConversationStoreArgs } from './conversation-store-types'
import { createDurableCache } from './durable-cache'
import type { LogAccumulator } from './log-accumulator'
import { createLogWindow, sameLogSummary, type LogSummary } from './log-window'
import { logSummaryOf } from './log-summary-of'
import { createOutputTails } from './output-tails'
import { watchPendingTldr } from './pending-tldr-watch'
import { createRepaintTimers } from './repaint-timers'
import { advancedGate, attachedGate, gateIsDraining } from './reveal'
import { sameEvents, sameTurns } from './same-log'
import { watchSandbox } from './sandbox-source'
import { settledModel } from './settled-model'
import {
  sidebarFoldFrom,
  sidebarFrom,
  sameSidebar,
  type SidebarContainer,
  type SidebarModel,
} from './sidebar-model'
import { isInertSignal } from './inert-signal'
import { createStepTracker } from './step-tracker'
import { traceSetName } from './trace-set-name'
import { transcriptSandboxOf } from './transcript-sandbox'
import { pendingTldrOf, type PendingTldr } from '../ui/tldr-feed-store'
import { IDLE_PROGRESS, turnObserved, type TurnProgress } from './turn-progress'

export type { ConversationStore, ConversationStoreArgs } from './conversation-store-types'

const NO_TURNS: readonly TurnSpend[] = Object.freeze([])

export function createConversationStore(args: ConversationStoreArgs): ConversationStore {
  const paceReveal = args.paceReveal ?? false
  const readClock = args.readClock ?? Date.now
  let thinking: EThinkingVisibility = args.thinking ?? SHIPPED_THINKING
  let tldrStatus = true
  let name: string | null = args.name ?? null
  let events: readonly Event[] = args.events ?? []
  let turns: readonly TurnSpend[] = args.turns ?? NO_TURNS
  let progress: TurnProgress = IDLE_PROGRESS
  let turn: TurnClock = IDLE_TURN
  let gate: RevealGate | null = null
  let sandbox: SidebarContainer | null = args.sandbox?.current() ?? null
  let channelWorking = false
  let pendingTldr: PendingTldr | null = pendingTldrOf(args.threadId) ?? null
  const tracker = createStepTracker()
  const tails = createOutputTails()
  const durableOf = createDurableCache()
  let projected: readonly Event[] | null = null

  const logWindow = createLogWindow({ effects: args.effects ?? (() => undefined) })
  logWindow.seed({ events, ...(args.base === undefined ? {} : { base: args.base }) })

  const summaryNow = (): LogSummary => logSummaryOf({ acc: logWindow.acc, events })
  let logSummary = summaryNow()

  const durableNow = () => durableOf({ events, turns })

  const sidebarNow = (): SidebarModel =>
    sidebarFrom({ fold: sidebarFoldFrom(logWindow.acc), turn, turns, priceOf: args.priceOf, name })

  let model = assembleTranscript({
    durable: durableNow(),
    persistedFailure: persistedFailureOf(events),
    live: [],
    thinking,
    pendingTldr,
    tldrStatus,
    sandbox: transcriptSandboxOf(sandbox),
  })
  let sidebar = sidebarNow()

  args.projectEvents?.({ events })
  projected = events

  const listeners = new Set<() => void>()

  const wake = () => {
    for (const listener of [...listeners]) listener()
  }

  const republish = () => {
    turn = progress.clock
    tracker.pruneSuperseded(events)
    tails.prune(events)
    const nextSummary = summaryNow()
    if (!sameLogSummary(logSummary, nextSummary)) logSummary = nextSummary
    model = settledModel({
      previous: model,
      derived: assembleTranscript({
        durable: durableNow(),
        persistedFailure: persistedFailureOf(events),
        live: tracker.live(events),
        reveal: gate,
        thinking,
        pendingTldr,
        tldrStatus,
        sandbox: transcriptSandboxOf(sandbox),
        outputs: tails.map,
        working: channelWorking,
      }),
    })
    const nextSidebar = sidebarNow()
    if (!sameSidebar(sidebar, nextSidebar)) sidebar = nextSidebar
    if (projected !== events) {
      args.projectEvents?.({ events })
      projected = events
    }
    wake()
  }

  const timers = createRepaintTimers({ republish })

  const scheduleFrame = () =>
    timers.scheduleFrame(() => {
      const tail = tracker.tailRun(events)
      gate = advancedGate({ gate, tail })
      republish()
      if (gateIsDraining({ gate, tail })) scheduleFrame()
    })

  const repaintNow = () => {
    timers.cancelRepaint()
    republish()
  }

  const handleSignal = (signal: ChannelSignal) => {
    if (signal.type === 'context-changed') return
    progress = turnObserved({ progress, signal, now: readClock() })

    if (signal.type === 'turn-working') {
      if (signal.working === channelWorking) return
      channelWorking = signal.working
      repaintNow()
      return
    }

    if (isInertSignal(signal)) return
    if (signal.type === 'retry-waiting') {
      republish()
      return
    }

    if (signal.type === 'tool-output') {
      tails.append({ callId: signal.callId, text: signal.text })
      timers.scheduleRepaint()
      return
    }

    tracker.absorb(signal)

    if (paceReveal && signal.type === 'chunk') {
      gate = attachedGate({ gate, tail: tracker.tailRun(events) })
      scheduleFrame()
      return
    }

    if (signal.type === 'chunk') {
      timers.scheduleRepaint()
      return
    }

    gate = null
    repaintNow()
  }

  let unsubscribeFromChannel: Unsubscribe | undefined = args.channel.subscribe({
    threadId: args.threadId,
    listener: handleSignal,
  })

  const unsubscribeFromFeed = watchPendingTldr({
    threadId: args.threadId,
    current: () => pendingTldr,
    onChange: (next) => {
      pendingTldr = next
      republish()
    },
  })

  const unsubscribeFromSandbox = watchSandbox({
    source: args.sandbox,
    current: () => sandbox,
    onMoved: (next) => {
      sandbox = next
      republish()
    },
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    getSnapshot: () => model,

    getSidebar: () => sidebar,

    getTurn: () => turn,

    setEvents(next) {
      const logMoved = !sameEvents({ left: events, right: next.events })
      const spendMoved = next.turns !== undefined && !sameTurns({ left: turns, right: next.turns })
      if (!logMoved && !spendMoved) return

      if (logMoved) logWindow.advance({ events: next.events })
      events = next.events
      if (next.turns !== undefined) turns = next.turns
      republish()
    },

    resetLog(next) {
      logWindow.reset({ events: next.events, base: next.base })
      events = next.events
      if (next.turns !== undefined) turns = next.turns
      republish()
    },

    getLogSummary() {
      return logSummary
    },

    republish() {
      republish()
    },

    stampTurn(advance) {
      const next = advance(progress)
      const clockMoved = next.clock !== progress.clock
      progress = next
      if (clockMoved) republish()
    },

    liveSteps() {
      return tracker.live(events)
    },

    supersedeFailure() {
      if (!tracker.dropFailedTail(events)) return

      republish()
    },

    resetSteps() {
      tracker.reset()
      tails.clear()
      republish()
    },

    setThinking(next) {
      if (next === thinking) return
      thinking = next
      republish()
    },

    setTldrStatus(next) {
      if (next === tldrStatus) return
      tldrStatus = next
      republish()
    },

    setName(next) {
      traceSetName({ threadId: args.threadId, from: name, to: next })
      if (next === name) return
      name = next
      republish()
    },

    dispose() {
      timers.dispose()
      unsubscribeFromChannel?.()
      unsubscribeFromChannel = undefined
      unsubscribeFromFeed()
      unsubscribeFromSandbox?.()
      listeners.clear()
    },
  }
}
