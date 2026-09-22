import { createHmac, timingSafeEqual } from 'node:crypto'

const HEX_PATTERN = /^[0-9a-f]+$/i

// Linear sends the bare hex digest in Linear-Signature, with no sha256= prefix.
// https://linear.app/developers/webhooks#securing-webhooks
export function verifyLinearSignature(args: {
  secret: string
  rawBody: Buffer
  signatureHeader: string | undefined
}): boolean {
  if (args.signatureHeader === undefined) return false
  if (!HEX_PATTERN.test(args.signatureHeader)) return false

  const provided = Buffer.from(args.signatureHeader, 'hex')
  const expected = createHmac('sha256', args.secret).update(args.rawBody).digest()
  if (provided.length !== expected.length) return false

  return timingSafeEqual(provided, expected)
}
