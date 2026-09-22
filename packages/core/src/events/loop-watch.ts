import { wrapUntrusted } from '../web/untrusted'
import type { EventDraft } from './body'
import type { Event } from './envelope'

export const LOOP_WATCH_MIN_SPEECHES = 3
export const LOOP_WATCH_WINDOW = 30
export const LOOP_WATCH_NOTICE_STEPS = 3
export const LOOP_WATCH_CUT_ANCHOR_SLOP = 5
export const LOOP_WATCH_CUT_SAME_ANCHOR_MAX = 2
export const LOOP_WATCH_CUT_MAX_PER_TURN = 4

const SPEECH_CLIP = 300
const INPUT_CLIP = 200
const RESULT_CLIP = 100

const clip = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`

const labelOf = (event: { description?: string | undefined; command: string }): string =>
  event.description ?? clip(event.command, 80)

const speechOf = (event: Event & { type: 'assistant-said' }): string =>
  event.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()

const lineOf = (event: Event): string | undefined => {
  if (event.type === 'assistant-said') {
    const speech = speechOf(event)
    return speech.length === 0 ? undefined : `agent: ${clip(speech, SPEECH_CLIP)}`
  }
  if (event.type === 'tool-called') {
    return `tool ${event.name}: ${clip(JSON.stringify(event.input) ?? '', INPUT_CLIP)}`
  }
  if (event.type === 'tool-result') {
    const seen = event.modelText ?? JSON.stringify(event.output) ?? ''
    return `result: ${clip(seen, RESULT_CLIP)}`
  }
  if (event.type === 'tool-denied') {
    return `${event.name} was refused: ${clip(event.reason, RESULT_CLIP)}`
  }
  if (event.type === 'nudge') {
    return `harness: ${clip(event.text, RESULT_CLIP)}`
  }
  if (event.type === 'agent-ended') {
    return `sub-agent "${clip(event.intent, 120)}" (${event.agentType}) ${event.status}: ${clip(event.prose, 160)}`
  }
  if (event.type === 'background-shell-ended') {
    const exit = event.exitCode === undefined ? '' : `, exit ${event.exitCode}`
    return `shell "${labelOf(event)}" ended (${event.status}${exit})`
  }
  if (event.type === 'background-shell-awaiting-input') {
    return `shell "${labelOf(event)}" is waiting for input`
  }
  if (event.type === 'background-shell-matched') {
    return `shell "${labelOf(event)}" matched its watch (${event.matchCount} lines)`
  }
  if (event.type === 'service-ended') {
    return `service "${labelOf(event)}" ended (${event.status})`
  }
  return undefined
}

export type LoopWatchStep = { seq: number; line: string }

const lastSteeringIndex = (events: readonly Event[]): number =>
  events.findLastIndex((event) => event.type === 'user-said' || event.type === 'nudge')

/**
 * The judgeable window: what the agent has done since the last steering event. Below
 * LOOP_WATCH_MIN_SPEECHES there is no pattern to judge, so the caller skips the consultation
 * entirely. A user message resets the window because steering is new information, and a nudge
 * resets it for the same reason — the judgement after a warning must grade what the agent did
 * next, not the pattern it was already warned about.
 */
export function loopWatchWindow({
  events,
}: {
  events: readonly Event[]
}): readonly LoopWatchStep[] | undefined {
  const since = events.slice(lastSteeringIndex(events) + 1)

  const speeches = since.filter(
    (event) => event.type === 'assistant-said' && speechOf(event).length > 0,
  )
  if (speeches.length < LOOP_WATCH_MIN_SPEECHES) return undefined

  const steps = since.slice(-LOOP_WATCH_WINDOW).flatMap((event) => {
    const line = lineOf(event)
    return line === undefined ? [] : [{ seq: event.seq, line }]
  })
  return steps.length === 0 ? undefined : steps
}

export function renderLoopWatchSteps({ steps }: { steps: readonly LoopWatchStep[] }): string {
  return [
    "The agent's steps since the last user message or harness nudge, oldest first, each numbered with its sequence:",
    wrapUntrusted({
      source: 'agent-steps',
      body: steps.map((step) => `- [${step.seq}] ${step.line}`).join('\n'),
    }),
  ].join('\n\n')
}

export function loopWatchState({ events }: { events: readonly Event[] }): string | undefined {
  const steps = loopWatchWindow({ events })
  return steps === undefined ? undefined : renderLoopWatchSteps({ steps })
}

/**
 * The rewind target for a watchdog cut: the judge points at the step where the loop began, and
 * the cut removes that step and everything after it, so the target is the speech at or before
 * the pick — cutting from a speech boundary, never from the middle of a tool call — minus one.
 * Undefined when no speech in the window reaches the pick, which sends the caller to the nudge.
 */
export function loopCutTarget({
  events,
  seq,
}: {
  events: readonly Event[]
  seq: number
}): number | undefined {
  const window = events.slice(lastSteeringIndex(events) + 1)
  const speech = window.findLast(
    (event) => event.seq <= seq && event.type === 'assistant-said',
  )
  return speech === undefined ? undefined : speech.seq - 1
}

/**
 * Whether another cut is allowed: a turn cuts at most LOOP_WATCH_CUT_MAX_PER_TURN times, and a
 * neighbourhood — anchors within LOOP_WATCH_CUT_ANCHOR_SLOP of each other, because a loop that
 * re-forms a step off from the last cut is the same failure, not a new one — gets
 * LOOP_WATCH_CUT_SAME_ANCHOR_MAX cuts before the caller escalates to the nudge.
 */
export function loopWatchCutAllowed({
  previous,
  anchor,
}: {
  previous: readonly number[]
  anchor: number
}): boolean {
  if (previous.length >= LOOP_WATCH_CUT_MAX_PER_TURN) return false
  const near = previous.filter(
    (seen) => Math.abs(seen - anchor) <= LOOP_WATCH_CUT_ANCHOR_SLOP,
  ).length
  return near < LOOP_WATCH_CUT_SAME_ANCHOR_MAX
}

export function loopWatchCutNotice({ steps }: { steps: number }): string {
  return [
    `Atlas's watchdog cut ${steps} steps from this turn: they were judged to be a loop — the same kind of work repeating without new information — and loops left in context invite more looping, so they were removed from the history you see.`,
    'Do not resume the pattern. If you were waiting on something, end the turn with no tool call and the next event will wake you. If the approach itself was failing, name what is missing and either take a different one or hand back to the operator.',
  ].join(' ')
}

export function loopWatchCutNoticeDraft({ steps }: { steps: number }): EventDraft {
  return { type: 'nudge', text: loopWatchCutNotice({ steps }), lifetimeSteps: LOOP_WATCH_NOTICE_STEPS }
}

export function loopWatchNotice(): string {
  return [
    'Atlas\'s watchdog judged this turn to be looping: the recent steps above repeat the same kind of action without new information arriving between them.',
    'If you are waiting on something, end the turn with no tool call — the next event will wake you. If each round genuinely found something new, name what is still missing in one sentence, then either finish or hand back to the operator.',
  ].join(' ')
}

export function loopWatchNudgeDraft(): EventDraft {
  return { type: 'nudge', text: loopWatchNotice(), lifetimeSteps: LOOP_WATCH_NOTICE_STEPS }
}
