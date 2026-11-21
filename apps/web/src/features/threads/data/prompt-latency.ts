import { EStepEnd, type StepSignal } from '@dltech/atlas-client/channel'
import type { Chunk } from '@dltech/atlas-core'
import type { WireEvent } from '@dltech/atlas-wire/web'

import { track } from '@/lib/analytics/analytics'

import type { Schedule } from './thread-signals'
import { timeoutSchedule } from './thread-signals'

export const PROMPT_LATENCY_TTL_MS = 15 * 60 * 1000

export const PROMPT_TURN_STARTED = 'prompt_turn_started'
export const PROMPT_FIRST_OUTPUT = 'prompt_first_output'

export enum EPromptPath {
  Live = 'live',
  Queued = 'queued',
}

const OUTPUT_EVENT_TYPES: ReadonlySet<string> = new Set(['assistant-said', 'tool-called'])
const FAILURE_EVENT_TYPES: ReadonlySet<string> = new Set(['run-failed', 'turn-failed'])

export type PromptLatencySink = (event: string, props: Record<string, unknown>) => void

type PendingPrompt = {
  sendId: string
  startedAt: number
  startedAtEpoch: number
  podState: string
  turnWasRunning: boolean
  path: EPromptPath | null
  turnStartedSent: boolean
  firstOutputSent: boolean
  cancelExpiry: () => void
}

const isVisibleChunk = (chunk: Chunk): boolean => {
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return chunk.text.length > 0
  return chunk.type === 'tool-input-start' || chunk.type === 'tool-call'
}

const isOutputSignal = (signal: StepSignal): boolean =>
  signal.type === 'chunk' && isVisibleChunk(signal.chunk)

export function createPromptLatency(args: {
  now: () => number
  epoch: () => number
  sink: PromptLatencySink
  schedule?: Schedule
}) {
  const schedule = args.schedule ?? timeoutSchedule
  const pending = new Map<string, PendingPrompt>()
  const retired = new Map<string, string>()

  const drop = ({ threadId }: { threadId: string }): void => {
    const held = pending.get(threadId)
    if (held === undefined) return
    held.cancelExpiry()
    pending.delete(threadId)
  }

  const retire = ({ threadId }: { threadId: string }): void => {
    const held = pending.get(threadId)
    if (held === undefined) return
    retired.set(threadId, held.sendId)
    drop({ threadId })
  }

  const begin = (start: {
    threadId: string
    sendId: string
    podState: string
    turnWasRunning: boolean
  }): void => {
    if (pending.has(start.threadId)) return
    if (retired.get(start.threadId) === start.sendId) return
    const cancelExpiry = schedule({
      delayMs: PROMPT_LATENCY_TTL_MS,
      run: () => drop({ threadId: start.threadId }),
    })
    pending.set(start.threadId, {
      sendId: start.sendId,
      startedAt: args.now(),
      startedAtEpoch: args.epoch(),
      podState: start.podState,
      turnWasRunning: start.turnWasRunning,
      path: null,
      turnStartedSent: false,
      firstOutputSent: false,
      cancelExpiry,
    })
  }

  const emit = (held: PendingPrompt, event: string): void => {
    args.sink(event, {
      latency_ms: Math.round(args.now() - held.startedAt),
      path: held.turnWasRunning ? EPromptPath.Live : (held.path ?? EPromptPath.Queued),
      pod_state: held.podState,
      ...(held.turnWasRunning ? { turn_was_running: true } : {}),
    })
  }

  const markPath = (chosen: { threadId: string; sendId: string; path: EPromptPath }): void => {
    const held = pending.get(chosen.threadId)
    if (held === undefined || held.sendId !== chosen.sendId) return
    held.path = chosen.path
  }

  const turnStarted = ({ threadId }: { threadId: string }): void => {
    const held = pending.get(threadId)
    if (held === undefined || held.turnStartedSent) return
    held.turnStartedSent = true
    emit(held, PROMPT_TURN_STARTED)
  }

  const firstOutput = ({ threadId }: { threadId: string }): void => {
    const held = pending.get(threadId)
    if (held === undefined || held.firstOutputSent) return
    held.firstOutputSent = true
    emit(held, PROMPT_FIRST_OUTPUT)
    retire({ threadId })
  }

  const sawEvents = (seen: { threadId: string; events: readonly WireEvent[] }): void => {
    const held = pending.get(seen.threadId)
    if (held === undefined) return
    const fresh = seen.events.filter((event) => Date.parse(event.at) >= held.startedAtEpoch)
    if (fresh.some((event) => FAILURE_EVENT_TYPES.has(event.type))) {
      drop({ threadId: seen.threadId })
      return
    }
    if (held.firstOutputSent) return
    if (!fresh.some((event) => OUTPUT_EVENT_TYPES.has(event.type))) return
    firstOutput({ threadId: seen.threadId })
  }

  const sawSignal = (seen: { threadId: string; signal: StepSignal }): void => {
    if (seen.signal.type === 'step-ended') {
      if (seen.signal.end === EStepEnd.Failed) drop({ threadId: seen.threadId })
      return
    }
    if (isOutputSignal(seen.signal)) firstOutput({ threadId: seen.threadId })
  }

  return { begin, drop, markPath, turnStarted, firstOutput, sawEvents, sawSignal }
}

export type PromptLatency = ReturnType<typeof createPromptLatency>

export const promptLatency = createPromptLatency({
  now: () => performance.now(),
  epoch: () => Date.now(),
  sink: track,
})
