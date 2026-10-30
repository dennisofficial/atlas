import { secretOf, type Credential } from '@dltech/atlas-core'

export class MissingKeyError extends Error {
  constructor(label: string) {
    super(`The ${label} account Atlas resolved carries no key. Add one with /auth.`)
    this.name = 'MissingKeyError'
  }
}

/**
 * `@ai-sdk/openai-compatible` builds its headers as `...options.apiKey && { Authorization: ... }`,
 * so an empty key ships a request carrying no Authorization header at all and the vendor answers
 * "Missing Authentication header" — a sentence about the request that says nothing about the
 * account it came from.
 */
export function providerKey(args: { credential: Credential; label: string }): string {
  const held = secretOf(args.credential)
  if (held.length > 0) return held

  throw new MissingKeyError(args.label)
}
