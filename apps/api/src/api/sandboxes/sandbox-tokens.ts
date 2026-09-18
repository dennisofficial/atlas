import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN_BYTES = 32

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export function mintSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashSessionToken(token) }
}

export function tokenMatches(args: { token: string; tokenHash: string }): boolean {
  const offered = Buffer.from(hashSessionToken(args.token))
  const stored = Buffer.from(args.tokenHash)
  if (offered.length !== stored.length) return false
  return timingSafeEqual(offered, stored)
}
