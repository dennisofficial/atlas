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
}

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
  model: { ref: 'anthropic/x', effort: 'high', fast: false },
})

const ROWS: readonly StreamSessionRow[] = [
  rowOf({ sessionId: 'session-old', title: 'older work', updatedAt: '2026-11-01T00:00:00.000Z' }),
  rowOf({ sessionId: 'session-new', title: 'newer work', updatedAt: '2026-11-20T00:00:00.000Z' }),
]

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const mount = async (args: { open: OpenRequest }): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-launch-flags-'))
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
      launch={{ open: args.open, model: null }}
    />,
    { width: 100, height: 30 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })
  return { client: () => held, setup }
}

describe('launch flags', () => {
  test('--continue opens the newest session', async () => {
    const mounted = await mount({ open: { mode: EOpenMode.Continue } })

    try {
      mounted.client()?.pushRows(ROWS)
      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'esc back',
        within: WITHIN,
      })
      expect(frame).toContain('newer work')
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('--resume opens the titled row', async () => {
    const mounted = await mount({ open: { mode: EOpenMode.Resume, handle: 'older work' } })

    try {
      mounted.client()?.pushRows(ROWS)
      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'esc back',
        within: WITHIN,
      })
      expect(frame).toContain('older work')
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('a miss stays on the list and says so', async () => {
    const mounted = await mount({ open: { mode: EOpenMode.Resume, handle: 'nothing' } })

    try {
      mounted.client()?.pushRows(ROWS)
      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'no session matched --resume nothing',
        within: WITHIN,
      })
      expect(frame).toContain('newer work')
      expect(frame).not.toContain('esc back')
    } finally {
      await teardown(mounted.setup)
    }
  })
})
