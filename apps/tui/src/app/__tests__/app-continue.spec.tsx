import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { currentNotices, dismissNotice } from '../../ui/notice-store'
import {
  ACCOUNT_FILE_VERSION,
  readAccount,
  writeAccount,
  type AccountFile,
} from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { EOpenMode, type OpenRequest } from '../launch-flags'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const WITHIN = 15_000

const ACCOUNT: AccountFile = {
  version: ACCOUNT_FILE_VERSION,
  apiUrl: API_URL,
  email: 'dennis@example.test',
  token: 'token-1',
  preferences: {},
  lastSessionId: null,
}

const rowOf = (args: {
  sessionId: string
  title: string
  updatedAt: string
  archivedAt?: string
}): StreamSessionRow => ({
  sessionId: args.sessionId,
  projectId: null,
  title: args.title,
  naming: false,
  mainThreadId: 'thread-1',
  createdAt: args.updatedAt,
  updatedAt: args.updatedAt,
  archivedAt: args.archivedAt ?? null,
  model: { ref: 'claude-sonnet-4-5', effort: 'high', fast: false },
})

const NEWER_TITLE = 'finished later'

const OPENED_TITLE = 'the session I had open'

const NEWER = rowOf({
  sessionId: 'session-a',
  title: NEWER_TITLE,
  updatedAt: '2026-11-20T00:00:00.000Z',
})

const OPENED = rowOf({
  sessionId: 'session-b',
  title: OPENED_TITLE,
  updatedAt: '2026-11-01T00:00:00.000Z',
})

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
  accountPath: string
}

const mount = async (args: {
  home: string
  open: OpenRequest
  rows: readonly StreamSessionRow[]
  account?: AccountFile
}): Promise<Mounted> => {
  const accountPath = join(args.home, 'account.json')
  const account = args.account ?? readAccount({ path: accountPath })
  if (args.account !== undefined) writeAccount({ path: accountPath, account: args.account })

  let held: FakeSessionClient | null = null
  const createClient: SessionClientFactory = (clientArgs) => {
    held = fakeSessionClient({ onAuthLost: clientArgs.onAuthLost })
    return held
  }

  const setup = await testRender(
    <AppNext
      accountPath={accountPath}
      initialAccount={account}
      apiUrl={API_URL}
      clientVersion="test"
      openUrl={() => undefined}
      createClient={createClient}
      onQuit={() => undefined}
      launch={{ open: args.open, model: null }}
    />,
    { width: 120, height: 30 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })
  const mounted = { client: () => held, setup, accountPath }
  mounted.client()?.pushRows(args.rows)
  return mounted
}

describe('--continue', () => {
  test('reopens the session that was open, not the newer one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-app-continue-'))
    const first = await mount({
      home,
      open: { mode: EOpenMode.New },
      rows: [NEWER, OPENED],
      account: ACCOUNT,
    })

    try {
      await frameShowing({ setup: first.setup, text: NEWER_TITLE, within: WITHIN })
      first.setup.mockInput.pressArrow('down')
      first.setup.mockInput.pressEnter()

      const frame = await frameShowing({ setup: first.setup, text: 'esc back', within: WITHIN })
      expect(frame).toContain(OPENED_TITLE)
      expect(readAccount({ path: first.accountPath })?.lastSessionId).toBe('session-b')
    } finally {
      await teardown(first.setup)
    }

    const second = await mount({
      home,
      open: { mode: EOpenMode.Continue },
      rows: [NEWER, OPENED],
    })

    try {
      const frame = await frameShowing({ setup: second.setup, text: 'esc back', within: WITHIN })
      expect(frame).toContain(OPENED_TITLE)
      expect(frame).not.toContain(NEWER_TITLE)
    } finally {
      await teardown(second.setup)
    }
  }, 60_000)

  test('an archived last session falls back to the newest and says so', async () => {
    const home = mkdtempSync(join(tmpdir(), 'atlas-app-continue-'))
    dismissNotice()
    const mounted = await mount({
      home,
      open: { mode: EOpenMode.Continue },
      rows: [NEWER, { ...OPENED, archivedAt: '2026-11-22T00:00:00.000Z' }],
      account: { ...ACCOUNT, lastSessionId: 'session-b' },
    })

    try {
      const frame = await frameShowing({ setup: mounted.setup, text: 'esc back', within: WITHIN })
      expect(frame).toContain(NEWER_TITLE)
      expect(currentNotices().map((notice) => notice.text)).toContain(
        'continued to the newest session: the one you last had open is archived',
      )
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
