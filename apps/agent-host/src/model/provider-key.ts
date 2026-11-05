import { secretOf, type Credential } from '@dltech/atlas-core'

import { withFailureAccount } from './failure-account'

export class MissingKeyError extends Error {
  constructor(label: string) {
    super(`The ${label} account Atlas resolved carries no key. Add one with /auth.`)
    this.name = 'MissingKeyError'
  }
}

export function providerKey(args: { credential: Credential; label: string }): string {
  const held = secretOf(args.credential)
  if (held.length > 0) return held

  throw withFailureAccount({
    error: new MissingKeyError(args.label),
    accountId: args.credential.accountId,
    authorizationDelivered: false,
  })
}
