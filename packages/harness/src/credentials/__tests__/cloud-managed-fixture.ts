import {
  authorityOf,
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  type AccountId,
  type AccountSecret,
  type Credential,
  type CredentialPort,
} from '@dltech/atlas-core'

import type { CloudSession } from '../../cloud/cloud-session'
import { OAuthConnectionsClient } from '../../cloud/oauth-connections-client'
import { memoryAccountStore } from '../account-store'
import { CloudManagedCredentialPort } from '../cloud-managed-credential-port'
import { CredentialError } from '../credential-error'
import { fakeOauthApi, type FakeApi } from './oauth-api-fake'

export const NOW = '2026-10-05T12:00:00.000Z'
export const session: CloudSession = { url: 'https://cloud.test', token: 'fake-session', email: null }

export const seed = (over: Partial<{ access: string; refresh: string; expiresAt: string }> = {}): AccountSecret => ({
  kind: EAuthKind.Oauth,
  tokens: {
    accessToken: over.access ?? 'fake-access',
    refreshToken: over.refresh ?? 'fake-refresh',
    expiresAt: over.expiresAt ?? '2026-10-05T13:00:00.000Z',
  },
})

export type Env = ReturnType<typeof setup>

export const setup = (args: { signedIn?: boolean; api?: FakeApi } = {}) => {
  const api = args.api ?? fakeOauthApi()
  const clock = { now: () => NOW }
  const accounts = memoryAccountStore({ clock })
  const state = { session: args.signedIn === false ? null : session }
  const localReads: string[] = []
  const local: CredentialPort = {
    read: async (request): Promise<Credential> => {
      localReads.push(String(request?.accountId))
      return { kind: EAuthKind.ApiKey, accountId: request?.accountId ?? ('x' as never), apiKey: 'fake-key' }
    },
    discard: async () => undefined,
  }
  let ids = 0
  const port = new CloudManagedCredentialPort({
    accounts,
    local,
    clock,
    session: () => state.session,
    clients: (s) => new OAuthConnectionsClient({ url: s.url, token: s.token, fetchFn: api.fetchFn }),
    newConnectionId: () => `oauth_${++ids}`,
  })
  const addOauth = (secret: AccountSecret = seed(), extra: { importedFrom?: string } = {}) =>
    accounts.add({
      provider: EAuthProvider.Anthropic,
      label: 'native',
      secret,
      origin: extra.importedFrom === undefined ? EAccountOrigin.Login : EAccountOrigin.Imported,
      ...extra,
    })

  return { api, accounts, port, state, localReads, addOauth }
}

export const settledSecret = async (accounts: Env['accounts'], id: AccountId) => {
  const stored = await accounts.read(id)
  if (stored?.secret.kind !== EAuthKind.Oauth) throw new Error('expected oauth')

  return stored.secret
}
