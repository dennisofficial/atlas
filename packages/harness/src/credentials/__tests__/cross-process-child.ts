import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  EAccountOrigin,
  EAuthKind,
  EAuthProvider,
  toAccountId,
  type CredentialPort,
} from '@dltech/atlas-core'

import { OAuthConnectionsClient } from '../../cloud/oauth-connections-client'
import { fileAccountStore } from '../account-store'
import { CloudManagedCredentialPort } from '../cloud-managed-credential-port'
import { RefreshingCredentialPort } from '../refreshing-credential-port'
import { fakeOauthApi } from './oauth-api-fake'

type Job = {
  mode: 'hold' | 'add' | 'refresh' | 'handoff'
  dir: string
  name: string
  accountId?: string
  blockOn?: string
  signal?: string
}

const NOW = '2026-10-05T12:00:00.000Z'
const POLL_MS = 10
const BARRIER_TIMEOUT_MS = 20_000
const HOLD_MS = 60

const job: Job = JSON.parse(process.argv[2] ?? '{}')
const path = (name: string): string => join(job.dir, name)
const record = (event: string): void => appendFileSync(path('events.log'), `${job.name} ${event}\n`)
const raise = (barrier: string): void => writeFileSync(path(barrier), '')

const reach = async (barrier: string): Promise<void> => {
  const deadline = Date.now() + BARRIER_TIMEOUT_MS
  while (!existsSync(path(barrier))) {
    if (Date.now() > deadline) throw new Error(`barrier ${barrier} never opened`)
    await new Promise((done) => setTimeout(done, POLL_MS))
  }
}

const clock = { now: () => NOW }
const store = () => fileAccountStore({ file: path('auth.json'), keyFile: path('key'), clock })
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const hold = async (): Promise<void> => {
  const locks = store()
  await reach('go')
  await locks.withAccountLock({
    accountId: toAccountId(job.accountId ?? 'acc_shared'),
    run: async () => {
      record('start')
      await sleep(HOLD_MS)
      record('end')
    },
  })
}

const add = async (): Promise<void> => {
  await reach('go')
  await store().add({
    provider: EAuthProvider.OpenRouter,
    label: job.name,
    secret: { kind: EAuthKind.ApiKey, apiKey: `fake-key-${job.name}` },
    origin: EAccountOrigin.Login,
  })
}

const refresh = async (): Promise<void> => {
  const port = new RefreshingCredentialPort({
    accounts: store(),
    clock,
    clients: {
      [EAuthProvider.Anthropic]: {
        refresh: async ({ refreshToken }) => {
          record(`redeem-start ${refreshToken}`)
          if (job.signal !== undefined) raise(job.signal)
          if (job.blockOn !== undefined) await reach(job.blockOn)
          record('redeem-end')

          return { accessToken: 'fake-rotated', refreshToken: 'fake-rotated-refresh', expiresAt: '2026-10-05T14:00:00.000Z' }
        },
      },
    },
  })
  await port.read({ provider: EAuthProvider.Anthropic }).then(
    () => record('read-ok'),
    () => record('read-refused'),
  )
}

const handoff = async (): Promise<void> => {
  const api = fakeOauthApi()
  const upload: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      record(`upload-start ${body?.tokens?.refreshToken ?? ''}`)
      if (job.signal !== undefined) raise(job.signal)
      if (job.blockOn !== undefined) await reach(job.blockOn)
      const response = await api.fetchFn(input, init)
      record('upload-end')

      return response
    },
    { preconnect: () => undefined },
  )
  const local: CredentialPort = {
    read: async () => Promise.reject(new Error('the local port must not be used')),
    discard: async () => undefined,
  }
  const port = new CloudManagedCredentialPort({
    accounts: store(),
    local,
    clock,
    session: () => ({ url: api.url, token: 'fake-session', email: null }),
    clients: (s) => new OAuthConnectionsClient({ url: s.url, token: s.token, fetchFn: upload }),
    newConnectionId: () => 'oauth_cross',
  })
  await port.handoffAll({ url: api.url, token: 'fake-session', email: null })
  await port.read({ provider: EAuthProvider.Anthropic }).then(
    () => record('read-ok'),
    () => record('read-failed'),
  )
}

const modes = { hold, add, refresh, handoff }
await modes[job.mode]()
