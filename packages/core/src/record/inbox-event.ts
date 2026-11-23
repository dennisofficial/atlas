import { z } from 'zod'

import type { EventBody } from '../events/body'
import { eventBodySchema } from '../events/schema'

export const INBOX_KIND_EVENT = 'event'

export const INBOX_EVENT_TYPES: ReadonlySet<string> = new Set([
  'pr-event',
  'run-event',
  'agent-reported',
  'agent-ended',
  'background-shell-ended',
  'service-ended',
  'sandbox-setup-reported',
  'session-archived',
  'model-fell-back',
  'nudge',
  'subscription-created',
  'subscription-ended',
])

export type InboxEvent = { event: EventBody }

const inboxEventPayloadSchema = z.strictObject({
  event: z.unknown(),
  clientId: z.string().min(1).optional(),
})

export type InboxEventRead = { ok: true; event: EventBody } | { ok: false; reason: string }

const parsedJsonOf = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

export const inboxEventOf = (payload: string): InboxEventRead => {
  const envelope = inboxEventPayloadSchema.safeParse(parsedJsonOf(payload))
  if (!envelope.success) return { ok: false, reason: 'unreadable event' }
  const body = eventBodySchema.safeParse(envelope.data.event)
  if (!body.success) return { ok: false, reason: 'unreadable event' }
  if (!INBOX_EVENT_TYPES.has(body.data.type)) {
    return { ok: false, reason: `event type ${body.data.type} cannot arrive through the inbox` }
  }
  if ('notice' in body.data && body.data.notice !== undefined) {
    return { ok: false, reason: 'an inbox event carries no notice stamp' }
  }
  return { ok: true, event: body.data }
}

export const inboxEventPayloadOf = (args: {
  event: EventBody
  clientId?: string | undefined
}): string => {
  const { event, clientId } = args
  const payload = { event, ...(clientId === undefined ? {} : { clientId }) }
  const read = inboxEventOf(JSON.stringify(payload))
  if (!read.ok) throw new Error(read.reason)
  return JSON.stringify({ event: read.event, ...(clientId === undefined ? {} : { clientId }) })
}
