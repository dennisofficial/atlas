import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { frameShowing } from '../../ui/__tests__/waiting'
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
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-chat-mention-'))
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

describe('the @ menu in a v2 session', () => {
  test('typing @ lists the session directory and tab completes the path', async () => {
    const mounted = await open()
    const client = clientOf(mounted)

    try {
      client.queueTrees([
        {
          directory: '',
          entries: [
            { name: 'src', isDirectory: true, changed: false },
            { name: 'README.md', isDirectory: false, changed: false },
          ],
        },
      ])

      await mounted.setup.mockInput.typeText('see @')
      await frameShowing({ setup: mounted.setup, text: 'README.md', within: WITHIN })

      expect(client.calls.treeFiles[0]?.sessionId).toBe(SESSION_ID)

      mounted.setup.mockInput.pressTab()
      await frameShowing({ setup: mounted.setup, text: 'see @src/', within: WITHIN })
      expect(client.calls.post).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)
})
