import { wrapUntrusted } from '../web/untrusted'
import type { EventDraft } from './body'
import type { Event } from './envelope'

export const LOOP_WATCH_MIN_SPEECHES = 3
export const LOOP_WATCH_WINDOW = 30
export const LOOP_WATCH_NOTICE_STEPS = 3

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
    return speech.length === 0 ? undefined : `- agent: ${clip(speech, SPEECH_CLIP)}`
  }
  if (event.type === 'tool-called') {
    return `- tool ${event.name}: ${clip(JSON.stringify(event.input) ?? '', INPUT_CLIP)}`
  }
  if (event.type === 'tool-result') {
    const seen = event.modelText ?? JSON.stringify(event.output) ?? ''
    return `- result: ${clip(seen, RESULT_CLIP)}`
  }
  if (event.type === 'tool-denied') {
    return `- ${event.name} was refused: ${clip(event.reason, RESULT_CLIP)}`
  }
  if (event.type === 'nudge') {
    return `- harness: ${clip(event.text, RESULT_CLIP)}`
  }
  if (event.type === 'agent-ended') {
    return `- sub-agent "${clip(event.intent, 120)}" (${event.agentType}) ${event.status}: ${clip(event.prose, 160)}`
  }
  if (event.type === 'background-shell-ended') {
    const exit = event.exitCode === undefined ? '' : `, exit ${event.exitCode}`
    return `- shell "${labelOf(event)}" ended (${event.status}${exit})`
  }
  if (event.type === 'background-shell-awaiting-input') {
    return `- shell "${labelOf(event)}" is waiting for input`
  }
  if (event.type === 'background-shell-matched') {
    return `- shell "${labelOf(event)}" matched its watch (${event.matchCount} lines)`
  }
  if (event.type === 'service-ended') {
    return `- service "${labelOf(event)}" ended (${event.status})`
  }
  return undefined
}

/**
 * Renders what the agent has done since the last steering event, for the decision model's loop
 * question. Below LOOP_WATCH_MIN_SPEECHES there is no pattern to judge, so the caller skips the
 * consultation entirely. A user message resets the window because steering is new information, and
 * a nudge resets it for the same reason — the judgement after a warning must grade what the agent
 * did next, not the pattern it was already warned about.
 */
export function loopWatchState({ events }: { events: readonly Event[] }): string | undefined {
  const lastSteering = events.findLastIndex(
    (event) => event.type === 'user-said' || event.type === 'nudge',
  )
  const since = events.slice(lastSteering + 1)

  const speeches = since.filter(
    (event) => event.type === 'assistant-said' && speechOf(event).length > 0,
  )
  if (speeches.length < LOOP_WATCH_MIN_SPEECHES) return undefined

  const lines = since
    .slice(-LOOP_WATCH_WINDOW)
    .map(lineOf)
    .filter((line) => line !== undefined)
  if (lines.length === 0) return undefined

  return [
    "The agent's steps since the operator last spoke, oldest first:",
    wrapUntrusted({ source: 'agent-steps', body: lines.join('\n') }),
  ].join('\n\n')
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
