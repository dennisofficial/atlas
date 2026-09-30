import { createHash, randomBytes } from 'node:crypto'

export type Pkce = { verifier: string; challenge: string; state: string }

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

// RFC 7636 §4.1: 32 random bytes base64url-encode to exactly 43 chars, no padding.
export const generatePkce = (): Pkce => {
  const verifier = base64url(randomBytes(32))

  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
    state: randomBytes(32).toString('hex'),
  }
}
