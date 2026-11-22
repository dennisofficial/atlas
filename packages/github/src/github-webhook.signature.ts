import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PREFIX = 'sha256='
const HEX_PATTERN = /^[0-9a-f]+$/i

export function verifyGithubSignature(args: {
  secret: string
  rawBody: Buffer
  signatureHeader: string | undefined
}): boolean {
  if (args.signatureHeader === undefined) return false
  if (!args.signatureHeader.startsWith(SIGNATURE_PREFIX)) return false

  const providedHex = args.signatureHeader.slice(SIGNATURE_PREFIX.length)
  if (!HEX_PATTERN.test(providedHex)) return false

  const provided = Buffer.from(providedHex, 'hex')
  const expected = createHmac('sha256', args.secret).update(args.rawBody).digest()
  if (provided.length !== expected.length) return false

  return timingSafeEqual(provided, expected)
}
