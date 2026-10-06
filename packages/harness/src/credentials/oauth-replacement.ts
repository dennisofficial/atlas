import { randomUUID } from 'node:crypto'

import { authorityOf, EAuthKind, type AccountId, type AccountSecret, type AccountStorePort } from '@dltech/atlas-core'

import type { CloudSession } from '../cloud/cloud-session'
import type { OAuthConnectionsClient } from '../cloud/oauth-connections-client'
import { CloudError } from '../cloud/cloud-transport'
import { sameUrl } from './oauth-owned-secret'

export async function prepareOauthReplacement(args: {
  accountId: AccountId
  secret: AccountSecret
  accounts: AccountStorePort
  session: CloudSession | null
  client: (session: CloudSession) => OAuthConnectionsClient
}): Promise<AccountSecret> {
  if (args.session === null || args.secret.kind !== EAuthKind.Oauth) return args.secret
  const held = await args.accounts.read(args.accountId)
  const authority = held === undefined ? undefined : authorityOf(held.secret)
  if (authority === undefined || !sameUrl(authority.url, args.session.url)) return args.secret

  let previousAuthorizationId = authority.previousAuthorizationId ?? authority.authorizationId ?? authority.connectionId
  try {
    const current = await args.client(args.session).metadata({ connectionId: authority.connectionId })
    if (current.provider !== held?.provider) return args.secret
    previousAuthorizationId = current.authorizationId
  } catch (error) {
    if (error instanceof CloudError && [404, 409].includes(error.status)) return args.secret
  }

  return {
    ...args.secret,
    authority: {
      url: authority.url,
      connectionId: authority.connectionId,
      authorizationId: randomUUID(),
      previousAuthorizationId,
    },
  }
}
