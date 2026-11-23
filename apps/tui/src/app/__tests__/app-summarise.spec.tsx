import {
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { ACCOUNT_FILE_VERSION, writeAccount, type AccountFile } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'

const API_URL = 'https://api.example.test'

const SESSION_ID = 'session-one'

const WITHIN = 15_000

const FIRST = 'build the parser'

const SECOND = 'now the lexer'

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

const REWIND: CommandEntry = {
  name: 'rewind',
  summary: 'rewind the conversation to one of your messages',
  group: ECommandGroup.Context,
  argumentHint: '<message>',
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
}

const LOG = mintEvents({
  bodies: [
    { type: 'user-said', text: FIRST },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'on it' }] },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'still on it' }] },
    { type: 'user-said', text: SECOND },
  ],
})

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const openSession = async (): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-summarise-'))
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
    { width: 100, height: 34 },
  )

  const mounted = { client: () => held, setup }
  await frameShowing({ setup, text: 'listing…', within: WITHIN })

  const client = mounted.client()
  if (client === null) throw new Error('the client never mounted')
  client.setCommands([REWIND])
  client.pushRows([ROW])
  await frameShowing({ setup, text: ROW.title ?? SESSION_ID, within: WITHIN })

  setup.mockInput.pressEnter()
  await frameShowing({ setup, text: 'esc back', within: WITHIN })
  client.pushEvents({ sessionId: SESSION_ID, events: LOG, live: true })
  await frameShowing({ setup, text: SECOND, within: WITHIN })

  return mounted
}

describe('summarising up to a message from the drawer', () => {
  test('posts one summarise command and leaves the draft empty', async () => {
    const mounted = await openSession()

    try {
      await mounted.setup.mockInput.typeText('/rewind')
      await frameShowing({ setup: mounted.setup, text: '/rewind', within: WITHIN })
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'Rewind', within: WITHIN })

      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'rewind to here', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      await frameShowing({ setup: mounted.setup, text: 'summarise up to here', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) === 1,
        describe: 'the summarise command',
        within: WITHIN,
      })

      expect(mounted.client()?.calls.runCommand).toEqual([
        { sessionId: SESSION_ID, name: 'summarise', args: { throughSeq: 3 } },
      ])
      expect(mounted.setup.captureCharFrame()).not.toContain(FIRST)
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)
})
