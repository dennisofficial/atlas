import { createHmac, timingSafeEqual } from 'node:crypto'

const SECRET_PREFIX = 'whsec_'
const SIGNATURE_VERSION = 'v1'
const TOLERANCE_SECONDS = 300

const signingKeyOf = (secret: string): Buffer =>
  Buffer.from(
    secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret,
    'base64',
  )

const signatureOf = (args: {
  key: Buffer
  id: string
  timestamp: string
  rawBody: Buffer
}): Buffer =>
  createHmac('sha256', args.key)
    .update(`${args.id}.${args.timestamp}.`)
    .update(args.rawBody)
    .digest()

const matches = (args: { expected: Buffer; provided: string }): boolean => {
  const provided = Buffer.from(args.provided, 'base64')
  if (provided.length !== args.expected.length) return false
  return timingSafeEqual(provided, args.expected)
}

// Standard Webhooks, which is how Agent37 signs a delivery (agent37.com/docs/agents-api/webhooks.md):
// HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}`, keyed by the base64 secret after `whsec_`.
export const verifyAgent37Signature = (args: {
  secret: string
  id: string
  timestamp: string
  rawBody: Buffer
  signatureHeader: string | undefined
  nowMs: number
}): boolean => {
  if (args.signatureHeader === undefined) return false
  const sentAt = Number(args.timestamp)
  if (!Number.isInteger(sentAt)) return false
  if (Math.abs(Math.floor(args.nowMs / 1000) - sentAt) > TOLERANCE_SECONDS) return false
  const expected = signatureOf({
    key: signingKeyOf(args.secret),
    id: args.id,
    timestamp: args.timestamp,
    rawBody: args.rawBody,
  })
  return args.signatureHeader.split(' ').some((entry) => {
    if (!entry.startsWith(`${SIGNATURE_VERSION},`)) return false
    return matches({ expected, provided: entry.slice(SIGNATURE_VERSION.length + 1) })
  })
}
