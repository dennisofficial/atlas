import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EAuthProvider } from '@dltech/atlas-core'
import {
  CloudService,
  CloudSessionStore,
  memoryAccountStore,
  SystemClock,
} from '@dltech/atlas-harness'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import { HEADING } from '../../ui/components/purge-confirm'
import { DOWNLOAD_PURGE_LABEL } from '../../ui/components/settings/account'
import { open, until, REPLY, THINKING } from './app-fixture'
import { fakeApp, scriptedModelPort } from './fake-app'

await grammarsReady()

const URL = 'https://cloud.test'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const ACCOUNT_ROW = {
  id: 'acc_cloud_1',
  provider: EAuthProvider.Anthropic,
  kind: 'api-key',
  origin: 'login',
  label: 'work',
  status: 'active',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
  secret: { kind: 'api-key', apiKey: 'sk-purge-me' },
}

const purgeFetch = (remote: { accounts: Map<string, Record<string, unknown>> }): typeof fetch => {
  const reply = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  return (async (input: unknown, init?: RequestInit) => {
    const path = String(input).slice(URL.length)
    const method = init?.method ?? 'GET'

    if (path === '/v1/accounts' && method === 'GET') {
      return reply(
        200,
        [...remote.accounts.values()].map((row) => {
          const { secret: _secret, ...account } = row
          return account
        }),
      )
    }
    if (path.startsWith('/v1/accounts/active/') && method === 'GET') {
      return reply(200, { accountId: 'acc_cloud_1' })
    }
    if (path.startsWith('/v1/accounts/')) {
      const id = path.slice('/v1/accounts/'.length)
      if (method === 'GET') return reply(200, remote.accounts.get(id))
      if (method === 'DELETE') {
        remote.accounts.delete(id)
        return reply(204)
      }
    }
    if (path === '/v1/secrets' && method === 'GET') return reply(200, { secrets: [] })
    if (path === '/v1/mcp-servers' && method === 'GET') return reply(200, { servers: [] })
    if (path === '/v1/user-context/memory' && method === 'GET') {
      const accept = new Headers(init?.headers).get('accept')
      if (accept === 'application/gzip') return reply(404, { message: 'no memory archive stored yet' })
      return reply(200, { bundle: null })
    }
    if (path === '/v1/user-context/memory' && method === 'DELETE') return reply(204)
    if (path === '/v1/github' && method === 'GET') return reply(200, { connected: false })

    return reply(404, { message: `unhandled ${method} ${path}` })
  }) as typeof fetch
}

let directory: string

const purgeCloud = (): { cloud: CloudService; remote: { accounts: Map<string, Record<string, unknown>> } } => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-purge-app-'))
  const sessions = new CloudSessionStore({
    file: join(directory, 'cloud.json'),
    keyFile: join(directory, 'key'),
  })
  sessions.write({ url: URL, token: 'sess_purge', email: 'dev@example.com' })

  const remote = { accounts: new Map([[ACCOUNT_ROW.id, ACCOUNT_ROW]]) }
  const cloud = new CloudService({
    sessions,
    localAccounts: memoryAccountStore({ clock: new SystemClock() }),
    defaultUrl: URL,
    fetchFn: purgeFetch(remote),
  })
  return { cloud, remote }
}

const scripted = () => scriptedModelPort({ script: { thinking: THINKING, reply: REPLY } })

afterEach(() => {
  dismissNotice()
  rmSync(directory, { recursive: true, force: true })
})

describe('the settings download & purge flow', () => {
  it('confirms through the drawer, lands the data locally, and ends signed out', async () => {
    const { cloud, remote } = purgeCloud()
    const mounted = await open({ app: fakeApp({ model: scripted(), cloud }) })

    try {
      mounted.pressCtrl('o')
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()
      mounted.pressTab()
      const accountPage = await mounted.frame()
      expect(accountPage).toContain(DOWNLOAD_PURGE_LABEL)
      expect(accountPage).toContain('dev@example.com')

      mounted.pressDown()
      await mounted.frame()
      mounted.pressEnter()
      const drawer = await mounted.frame()
      expect(drawer).toContain(HEADING)
      expect(drawer).toContain('signs you out')

      mounted.pressEnter()
      const found = await until({
        holds: async () =>
          currentNotices()
            .map((notice) => notice.text)
            .join('\n')
            .includes('Moved 1 account to this machine'),
        within: 20_000,
      })
      expect(found).toBe(true)

      const notice = currentNotices().map((one) => one.text).join('\n')
      expect(notice).toContain('deleted them from the cloud, and signed you out')

      const settled = await mounted.frame()
      expect(settled).toContain('not signed in')
      expect(settled).not.toContain(DOWNLOAD_PURGE_LABEL)
      expect(cloud.session()).toBeNull()
      expect(remote.accounts.size).toBe(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('cancelling the drawer leaves the session and the cloud untouched', async () => {
    const { cloud, remote } = purgeCloud()
    const mounted = await open({ app: fakeApp({ model: scripted(), cloud }) })

    try {
      mounted.pressCtrl('o')
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()
      mounted.pressTab()
      await mounted.frame()

      mounted.pressDown()
      await mounted.frame()
      mounted.pressEnter()
      const drawer = await mounted.frame()
      expect(drawer).toContain(HEADING)

      mounted.pressEscape()
      const settled = await mounted.frame()
      expect(settled).not.toContain(HEADING)
      expect(cloud.session()).not.toBeNull()
      expect(remote.accounts.size).toBe(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
