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
  return undefined
}

/**
 * Renders what the agent has done since the operator last spoke, for the decision model's loop
 * question. Below LOOP_WATCH_MIN_SPEECHES there is no pattern to judge, so the caller skips the
 * consultation entirely; a user message resets the window because steering is new information.
 */
export function loopWatchState({ events }: { events: readonly Event[] }): string | undefined {
  const lastSpoken = events.findLastIndex((event) => event.type === 'user-said')
  const since = events.slice(lastSpoken + 1)

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
