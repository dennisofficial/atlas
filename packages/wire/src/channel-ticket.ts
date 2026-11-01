import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

const TICKET_PREFIX = 'ct1'
const TICKET_AUDIENCE = 'serve-channel'
const KEY_CONTEXT = 'atlas.channel-ticket.v1'

const payloadSchema = z.object({
  aud: z.literal(TICKET_AUDIENCE),
  threadId: z.string(),
  exp: z.number(),
})

const keyOf = (serveToken: string): Buffer =>
  createHmac('sha256', serveToken).update(KEY_CONTEXT).digest()

const signatureOf = (args: { serveToken: string; payloadSegment: string }): Buffer =>
  createHmac('sha256', keyOf(args.serveToken)).update(args.payloadSegment).digest()

export const mintChannelTicket = (args: {
  serveToken: string
  threadId: string
  ttlSeconds: number
  nowMs: number
}): { ticket: string; expiresAt: string } => {
  if (args.serveToken.length === 0) throw new Error('a channel ticket needs a serve token')
  const exp = Math.floor(args.nowMs / 1000) + args.ttlSeconds
  const payloadSegment = Buffer.from(
    JSON.stringify({ aud: TICKET_AUDIENCE, threadId: args.threadId, exp }),
  ).toString('base64url')
  const signature = signatureOf({ serveToken: args.serveToken, payloadSegment })
  return {
    ticket: `${TICKET_PREFIX}.${payloadSegment}.${signature.toString('base64url')}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}

const parsedPayload = (segment: string): z.infer<typeof payloadSchema> | null => {
  try {
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(segment, 'base64url').toString()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const channelTicketThread = (args: {
  serveToken: string
  ticket: string
  nowMs: number
}): string | null => {
  if (args.serveToken.length === 0) return null
  const segments = args.ticket.split('.')
  const [prefix, payloadSegment, signatureSegment] = segments
  if (segments.length !== 3 || prefix !== TICKET_PREFIX) return null
  if (payloadSegment === undefined || signatureSegment === undefined) return null

  const expected = signatureOf({ serveToken: args.serveToken, payloadSegment })
  const offered = Buffer.from(signatureSegment, 'base64url')
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) return null

  const payload = parsedPayload(payloadSegment)
  if (payload === null || payload.exp * 1000 <= args.nowMs) return null
  return payload.threadId
}

export const channelTicketValid = (args: {
  serveToken: string
  threadId: string
  ticket: string
  nowMs: number
}): boolean => {
  if (args.serveToken.length === 0) return false
  const segments = args.ticket.split('.')
  const [prefix, payloadSegment, signatureSegment] = segments
  if (segments.length !== 3 || prefix !== TICKET_PREFIX) return false
  if (payloadSegment === undefined || signatureSegment === undefined) return false

  const expected = signatureOf({ serveToken: args.serveToken, payloadSegment })
  const offered = Buffer.from(signatureSegment, 'base64url')
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) return false

  const payload = parsedPayload(payloadSegment)
  if (payload === null || payload.threadId !== args.threadId) return false
  return payload.exp * 1000 > args.nowMs
}
