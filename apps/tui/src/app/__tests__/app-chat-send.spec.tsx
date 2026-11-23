import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { ACCOUNT_FILE_VERSION, writeAccount, type AccountFile } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const SESSION_ID = 'session-one'

const WITHIN = 15_000

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
}

const ROW: StreamSessionRow = {
  sessionId: SESSION_ID,
  projectId: null,
  title: 'the open session',
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-20T00:00:00.000Z',
  archivedAt: null,
  model: { ref: 'claude-sonnet-4-5', effort: 'high', fast: false },
}

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const open = async (): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-chat-send-'))
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
    />,
    { width: 100, height: 30 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })
  const client = held as FakeSessionClient | null
  client?.pushRows([ROW])
  await frameShowing({ setup, text: ROW.title ?? SESSION_ID, within: WITHIN })
  setup.mockInput.pressEnter()
  await frameShowing({ setup, text: 'esc back', within: WITHIN })

  return { client: () => held, setup }
}

const clientOf = (mounted: Mounted): FakeSessionClient => {
  const client = mounted.client()
  if (client === null) throw new Error('the client never arrived')
  return client
}

describe('sending from a v2 session', () => {
  test('return posts the draft and paints the row while it is in flight', async () => {
    const mounted = await open()
    const client = clientOf(mounted)

    try {
      client.holdPost(true)
      await mounted.setup.mockInput.typeText('hello')
      await frameShowing({ setup: mounted.setup, text: 'hello', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({ setup: mounted.setup, text: 'sending…', within: WITHIN })

      const posted = client.calls.post[0]
      expect(posted?.sessionId).toBe(SESSION_ID)
      expect(posted?.text).toBe('hello')
      expect(typeof posted?.clientId).toBe('string')

      client.pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({
          bodies: [{ type: 'user-said', text: 'hello', clientId: posted?.clientId }],
        }),
        live: true,
      })
      client.releasePost()

      await frameWhen({
        setup: mounted.setup,
        holds: (shot) => !shot.includes('sending…'),
        within: WITHIN,
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('a failed post keeps the draft and retries with the same clientId', async () => {
    const mounted = await open()
    const client = clientOf(mounted)
    let attempts = 0

    try {
      const failing = mounted.client()
      if (failing === null) throw new Error('no client')

      await mounted.setup.mockInput.typeText('hello')
      await frameShowing({ setup: mounted.setup, text: 'hello', within: WITHIN })

      const original = failing.api.post
      failing.api.post = async (input) => {
        attempts += 1
        await original(input)
        throw new Error('the network went away')
      }

      mounted.setup.mockInput.pressEnter()
      await frameWhen({
        setup: mounted.setup,
        holds: (shot) => shot.includes('the network went away'),
        within: WITHIN,
      })

      expect(attempts).toBe(1)
      const first = client.calls.post[0]?.clientId

      failing.api.post = original
      mounted.setup.mockInput.pressEnter()
      await frameWhen({
        setup: mounted.setup,
        holds: () => client.calls.post.length === 2,
        within: WITHIN,
      })

      expect(client.calls.post[1]?.clientId).toBe(first)
      expect(client.calls.post[1]?.text).toBe('hello')
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)
})
