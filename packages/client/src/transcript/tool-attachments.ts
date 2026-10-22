import { EContextSlot, type CallId, type Event } from '@dltech/atlas-core'

import { transcriptNotice } from './notice-barriers'

export type ContextAttachment = {
  id: string
  slot: string
  name: string
  content: string
}

export const NOTHING_ATTACHED: readonly ContextAttachment[] = Object.freeze([])

const MESSAGE_BADGES: ReadonlySet<string> = new Set([EContextSlot.Skill, EContextSlot.File])

export function attachmentsOf(events: readonly Event[]): Map<CallId, ContextAttachment[]> {
  const attached = new Map<CallId, ContextAttachment[]>()
  let lastCall: CallId | null = null

  for (const event of events) {
    if (brokenBy(event)) {
      lastCall = null
      continue
    }
    if (
      event.type === 'tool-called' ||
      event.type === 'tool-result' ||
      event.type === 'tool-denied'
    ) {
      lastCall = event.callId
      continue
    }
    if (event.type !== 'context-loaded' || lastCall === null || MESSAGE_BADGES.has(event.slot)) {
      continue
    }

    const attachment: ContextAttachment = {
      id: event.id,
      slot: event.slot,
      name: event.key,
      content: event.content,
    }
    const held = attached.get(lastCall)
    if (held === undefined) attached.set(lastCall, [attachment])
    else held.push(attachment)
  }

  return attached
}

/**
 * What ends a run.
 *
 * A step that only THINKS between two batches of calls is not a boundary a reader cares about — it
 * is the same stretch of work with reasoning in the middle — so only a text reply, an operator
 * message, a nudge, or a notice the transcript prints in place closes one. Anything narrower lets
 * the whole run render where its FIRST call landed, ahead of a completion or report notice the
 * reader already saw settle between the calls.
 */
export const brokenBy = (event: Event): boolean => {
  if (transcriptNotice(event)) return true
  if (event.type !== 'assistant-said') return false
  return event.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)
}
