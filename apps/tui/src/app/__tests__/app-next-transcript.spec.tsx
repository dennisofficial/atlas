import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EStreamBlockKind, type StreamSessionRow } from '@dltech/atlas-protocol'
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
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-next-transcript-'))
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
  const opened = { client: () => held, setup }
  opened.client()?.pushRows([ROW])
  await frameShowing({ setup, text: ROW.title ?? SESSION_ID, within: WITHIN })
  setup.mockInput.pressEnter()
  await frameShowing({ setup, text: 'esc back', within: WITHIN })

  return opened
}

describe('opening a v2 session', () => {
  test('paints the durable log of the session as transcript rows', async () => {
    const mounted = await open()

    try {
      mounted.client()?.pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({
          bodies: [
            { type: 'user-said', text: 'open the door' },
            { type: 'assistant-said', parts: [{ type: 'text', text: 'the door is open' }] },
          ],
        }),
        live: true,
      })

      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'open the door',
        within: WITHIN,
      })
      await frameShowing({ setup: mounted.setup, text: 'the door is open', within: WITHIN })
      expect(frame).toContain('the open session')
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('shows the live overlay before its durable event lands', async () => {
    const mounted = await open()

    try {
      mounted.client()?.pushOverlay({
        sessionId: SESSION_ID,
        key: { runId: 'run-2', step: 1, attempt: 0 },
        blocks: [{ block: 'b1', kind: EStreamBlockKind.Text, text: 'still arriving' }],
      })

      await frameShowing({ setup: mounted.setup, text: 'still arriving', within: WITHIN })
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('esc returns to the list', async () => {
    const mounted = await open()

    try {
      mounted.setup.mockInput.pressEscape()

      const frame = await frameWhen({
        setup: mounted.setup,
        holds: (shot) => !shot.includes('esc back'),
        within: WITHIN,
      })
      expect(frame).toContain('the open session')
    } finally {
      await teardown(mounted.setup)
    }
  })
})
