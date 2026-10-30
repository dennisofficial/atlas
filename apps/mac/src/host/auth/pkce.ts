import { createHash, randomBytes } from 'node:crypto'

export interface IPkcePair {
  verifier: string
  challenge: string
  state: string
}

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.1
export function createPkcePair(): IPkcePair {
  const verifier = randomBytes(32).toString('base64url')
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(16).toString('base64url'),
  }
}
