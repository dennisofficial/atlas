import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import {
  ACCOUNT_FILE_VERSION,
  readAccount,
  writeAccount,
  type AccountFile,
} from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

const WITHIN = 15_000

const rowOf = (args: {
  sessionId: string
  title: string
  updatedAt: string
}): StreamSessionRow => ({
  sessionId: args.sessionId,
  projectId: null,
  title: args.title,
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: args.updatedAt,
  updatedAt: args.updatedAt,
  archivedAt: null,
  model: { ref: 'claude-sonnet-4-5', effort: 'high', fast: false },
})

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
  accountPath: string
}

const mount = async (args: { fetchFn?: typeof fetch } = {}): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-next-'))
  const accountPath = join(home, 'account.json')
  writeAccount({ path: accountPath, account: ACCOUNT })

  let held: FakeSessionClient | null = null
  const createClient: SessionClientFactory = (clientArgs) => {
    held = fakeSessionClient({ onAuthLost: clientArgs.onAuthLost })
    return held
  }

  const setup = await testRender(
    <AppNext
      accountPath={accountPath}
      initialAccount={ACCOUNT}
      apiUrl={API_URL}
      clientVersion="test"
      openUrl={() => undefined}
      createClient={createClient}
      onQuit={() => undefined}
      {...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn })}
    />,
    { width: 100, height: 30 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })

  return { client: () => held, setup, accountPath }
}

describe('the session list', () => {
  test('paints a row per unarchived session, newest first', async () => {
    const mounted = await mount()

    try {
      mounted.client()?.pushRows([
        rowOf({
          sessionId: 'session-old',
          title: 'older work',
          updatedAt: '2026-11-01T00:00:00.000Z',
        }),
        rowOf({
          sessionId: 'session-new',
          title: 'newer work',
          updatedAt: '2026-11-20T00:00:00.000Z',
        }),
      ])

      const frame = await frameShowing({ setup: mounted.setup, text: 'newer work', within: WITHIN })
      expect(frame).toContain('older work')
      expect(frame.indexOf('newer work')).toBeLessThan(frame.indexOf('older work'))
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('a 401 deletes the account and returns to sign-in', async () => {
    const mounted = await mount()

    try {
      mounted.client()?.refuse(401)

      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'Sign in to Atlas Cloud from this terminal.',
        within: WITHIN,
      })
      expect(frame).toContain('your sign-in expired.')
      expect(readAccount({ path: mounted.accountPath })).toBeNull()
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('a 403 keeps the account and shows the awaiting-access screen', async () => {
    const mounted = await mount()

    try {
      mounted.client()?.refuse(403)

      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'This Atlas account is waiting for access to Atlas Cloud.',
        within: WITHIN,
      })
      expect(frame).toContain('Signed in as dennis@example.test.')
      expect(readAccount({ path: mounted.accountPath })).not.toBeNull()
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('s signs out over the API and removes the account file', async () => {
    const calls: string[] = []
    const fetchFn = (async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input))
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const mounted = await mount({ fetchFn })

    try {
      mounted.client()?.refuse(403)
      await frameShowing({
        setup: mounted.setup,
        text: 'This Atlas account is waiting for access to Atlas Cloud.',
        within: WITHIN,
      })

      mounted.setup.mockInput.pressKey('s')

      await frameShowing({
        setup: mounted.setup,
        text: 'Sign in to Atlas Cloud from this terminal.',
        within: WITHIN,
      })
      expect(calls.some((url) => url.endsWith('/api/auth/sign-out'))).toBe(true)
      expect(existsSync(mounted.accountPath)).toBe(false)
    } finally {
      await teardown(mounted.setup)
    }
  })
})
