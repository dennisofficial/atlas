export type Pkce = { verifier: string; challenge: string; state: string }

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const randomBase64url = (length: number): string =>
  base64url(crypto.getRandomValues(new Uint8Array(length)))

export const s256Challenge = async (verifier: string): Promise<string> =>
  base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )

export const createPkce = async (args: { verifierBytes: number }): Promise<Pkce> => {
  const verifier = randomBase64url(args.verifierBytes)
  return {
    verifier,
    challenge: await s256Challenge(verifier),
    state: randomBase64url(32),
  }
}
