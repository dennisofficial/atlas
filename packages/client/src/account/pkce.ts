export type PkcePair = { verifier: string; challenge: string; state: string }

const VERIFIER_BYTES = 32

const STATE_BYTES = 16

const base64urlOf = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.2
export const pkceChallengeOf = async (verifier: string): Promise<string> =>
  base64urlOf(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )

// https://datatracker.ietf.org/doc/html/rfc7636#section-4.1
export const createPkcePair = async (): Promise<PkcePair> => {
  const verifier = base64urlOf(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)))
  return {
    verifier,
    challenge: await pkceChallengeOf(verifier),
    state: base64urlOf(crypto.getRandomValues(new Uint8Array(STATE_BYTES))),
  }
}
