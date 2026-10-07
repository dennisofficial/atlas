import type { CallId, ThreadId, ChunkFilter, Event, EventOfType, EventRef } from '@dltech/atlas-core'

import { retainReplayable, type InFlightSlots } from './in-flight'
import {
  EStepEnd,
  toStepId,
  type ChannelSignal,
  type OperatorInputRequest,
  type RetryWaitingSignal,
  type StepId,
  type StepSignal,
} from './signal'

export type ChannelListener = (signal: ChannelSignal) => void

export type ListenerErrorSink = (cause: unknown) => void

export type Unsubscribe = () => void

export type DeltaChannelOptions = { readonly onListenerError?: ListenerErrorSink }

export type ThreadPublisher = {
  readonly threadId: ThreadId
  readonly onChunk: ChunkFilter
  toolOutput(args: { callId: CallId; text: string }): void
  eventsAppended(args?: { onListenerError?: ListenerErrorSink }): void
  settleAppend(args: { events: readonly Event[] }): void
  close(args: { end: EStepEnd }): void
  retrying(notice: Omit<RetryWaitingSignal, 'type'>): void
  turnWorking(args: { working: boolean }): void
  operatorInput(args: { open: OperatorInputRequest | null; onListenerError?: ListenerErrorSink }): void
}

export type DeltaChannel = {
  subscribe(args: { threadId: ThreadId; listener: ChannelListener }): Unsubscribe
  snapshot(args: { threadId: ThreadId }): readonly ChannelSignal[]
  publisherFor(args: { threadId: ThreadId; filter?: ChunkFilter | undefined }): ThreadPublisher
}

type ThreadState = {
  listeners: Set<ChannelListener>
  inFlight: StepSignal[]
  toolOutputSlots: InFlightSlots
  replay: readonly ChannelSignal[] | undefined
  operatorInput: OperatorInputRequest | null
  stepId: StepId | undefined
  stepsStarted: number
  working: boolean
}

const NOTHING_IN_FLIGHT: readonly StepSignal[] = Object.freeze([])

const durableAssistantEvent = (events: readonly Event[]): EventOfType<'assistant-said'> | undefined =>
  events.find((event): event is EventOfType<'assistant-said'> => event.type === 'assistant-said')

const refOf = (event: EventOfType<'assistant-said'> | undefined): EventRef | null =>
  event === undefined ? null : { eventId: event.id, seq: event.seq }

const needsAStepToFailIn = (args: { state: ThreadState; end: EStepEnd }): boolean =>
  args.state.stepId === undefined && args.end === EStepEnd.Failed

const endOf = (event: EventOfType<'assistant-said'> | undefined): EStepEnd =>
  event?.interrupted === true ? EStepEnd.Interrupted : EStepEnd.Completed

export function createDeltaChannel(options: DeltaChannelOptions = {}): DeltaChannel {
  const threads = new Map<ThreadId, ThreadState>()

  const stateFor = (threadId: ThreadId): ThreadState => {
    const existing = threads.get(threadId)
    if (existing !== undefined) return existing

    const created: ThreadState = {
      listeners: new Set(),
      inFlight: [],
      toolOutputSlots: new Map(),
      replay: undefined,
      stepId: undefined,
      stepsStarted: 0,
      working: false,
      operatorInput: null,
    }
    threads.set(threadId, created)
    return created
  }

  const forgetIfIdle = (args: { threadId: ThreadId; state: ThreadState }) => {
    if (
      args.state.listeners.size > 0 || args.state.stepId !== undefined ||
      args.state.working || args.state.operatorInput !== null
    ) return
    threads.delete(args.threadId)
  }

  const report = (args: { sink: ListenerErrorSink | undefined; cause: unknown }) => {
    try {
      args.sink?.(args.cause)
    } catch {
      return
    }
  }

  const deliver = (args: {
    listeners: Iterable<ChannelListener>
    signal: ChannelSignal
    onListenerError?: ListenerErrorSink | undefined
  }) => {
    const sink = args.onListenerError ?? options.onListenerError
    for (const listener of [...args.listeners]) {
      try {
        listener(args.signal)
      } catch (cause) {
        report({ sink, cause })
      }
    }
  }

  const notify = (args: { state: ThreadState; signal: ChannelSignal }) => {
    deliver({ listeners: args.state.listeners, signal: args.signal })
  }

  const WORKING_SIGNAL: StepSignal = Object.freeze({ type: 'turn-working', working: true })

  const stableReplay = (state: ThreadState): readonly ChannelSignal[] => {
    if (state.replay !== undefined) return state.replay
    if (!state.working && state.inFlight.length === 0 && state.operatorInput === null) return NOTHING_IN_FLIGHT
    const held: ChannelSignal[] = state.working ? [WORKING_SIGNAL, ...state.inFlight] : [...state.inFlight]
    if (state.operatorInput !== null) held.push({ type: 'operator-input', request: state.operatorInput })
    state.replay = Object.freeze(held)
    return state.replay
  }

  const publish = (args: { state: ThreadState; signal: StepSignal }) => {
    retainReplayable({
      inFlight: args.state.inFlight,
      slots: args.state.toolOutputSlots,
      signal: args.signal,
    })
    args.state.replay = undefined
    notify(args)
  }

  const markWorking = (args: { threadId: ThreadId; state: ThreadState; working: boolean }) => {
    if (args.state.working === args.working) return
    args.state.working = args.working
    args.state.replay = undefined
    notify({ state: args.state, signal: { type: 'turn-working', working: args.working } })
    if (!args.working) forgetIfIdle({ threadId: args.threadId, state: args.state })
  }

  const startStep = (args: { threadId: ThreadId; state: ThreadState }): StepId => {
    args.state.stepsStarted += 1
    const stepId = toStepId(`${args.threadId}#${args.state.stepsStarted}`)
    args.state.stepId = stepId
    args.state.inFlight = []
    args.state.toolOutputSlots.clear()
    args.state.replay = undefined
    publish({ state: args.state, signal: { type: 'step-started', stepId } })
    return stepId
  }

  const endStep = (args: {
    threadId: ThreadId
    state: ThreadState
    end: EStepEnd
    supersededBy: EventRef | null
  }): boolean => {
    const stepId = args.state.stepId
    if (stepId === undefined) return false

    args.state.stepId = undefined
    args.state.inFlight = []
    args.state.toolOutputSlots.clear()
    args.state.replay = undefined
    notify({
      state: args.state,
      signal: { type: 'step-ended', stepId, end: args.end, supersededBy: args.supersededBy },
    })
    forgetIfIdle({ threadId: args.threadId, state: args.state })
    return true
  }

  return {
    subscribe({ threadId, listener }) {
      const state = stateFor(threadId)
      for (const signal of stableReplay(state)) deliver({ listeners: [listener], signal })
      state.listeners.add(listener)

      return () => {
        state.listeners.delete(listener)
        forgetIfIdle({ threadId, state })
      }
    },

    snapshot({ threadId }) {
      const state = threads.get(threadId)
      if (state === undefined) return NOTHING_IN_FLIGHT
      return stableReplay(state)
    },

    publisherFor({ threadId, filter }) {
      return {
        threadId,

        onChunk(chunk) {
          const kept = filter === undefined ? chunk : filter(chunk)
          if (kept === null) return null

          const state = stateFor(threadId)
          const stepId = state.stepId ?? startStep({ threadId, state })
          publish({ state, signal: { type: 'chunk', stepId, chunk: kept } })
          return kept
        },

        toolOutput({ callId, text }) {
          publish({ state: stateFor(threadId), signal: { type: 'tool-output', callId, text } })
        },

        eventsAppended(args) {
          const state = threads.get(threadId)
          if (state === undefined) return

          deliver({
            listeners: state.listeners,
            signal: { type: 'events-appended' },
            onListenerError: args?.onListenerError,
          })
        },

        settleAppend({ events }) {
          const state = threads.get(threadId)
          if (state === undefined) return

          const durable = durableAssistantEvent(events)
          const ended = endStep({ threadId, state, end: endOf(durable), supersededBy: refOf(durable) })
          if (!ended) notify({ state, signal: { type: 'events-appended' } })
        },

        close({ end }) {
          const state = threads.get(threadId)
          if (state === undefined) return

          if (needsAStepToFailIn({ state, end })) startStep({ threadId, state })
          endStep({ threadId, state, end, supersededBy: null })
        },

        retrying(notice) {
          const state = stateFor(threadId)
          endStep({ threadId, state, end: EStepEnd.Retried, supersededBy: null })
          notify({ state: stateFor(threadId), signal: { type: 'retry-waiting', ...notice } })
        },

        turnWorking({ working }) {
          markWorking({ threadId, state: stateFor(threadId), working })
        },

        operatorInput({ open, onListenerError }) {
          const state = stateFor(threadId)
          state.operatorInput = open
          state.replay = undefined
          deliver({
            listeners: state.listeners,
            signal: { type: 'operator-input', request: open },
            onListenerError,
          })
          if (open === null) forgetIfIdle({ threadId, state })
        },
      }
    },
  }
}
