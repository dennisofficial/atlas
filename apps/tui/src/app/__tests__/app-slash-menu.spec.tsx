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

const COMMANDS: readonly CommandEntry[] = [
  {
    name: 'rewind',
    summary: 'rewind the conversation to one of your messages',
    group: ECommandGroup.Context,
    argumentHint: '<message>',
    kind: ECommandEntryKind.Command,
    source: ECommandSource.Builtin,
  },
  {
    name: 'rename',
    summary: 'name this session',
    group: ECommandGroup.Session,
    argumentHint: '<name>',
    kind: ECommandEntryKind.Command,
    source: ECommandSource.Builtin,
  },
  {
    name: 'model',
    summary: 'pick the model and the effort',
    group: ECommandGroup.Session,
    kind: ECommandEntryKind.Command,
    source: ECommandSource.Builtin,
    opens: 'model-picker' as CommandEntry['opens'],
  },
]

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const openSession = async (): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-slash-menu-'))
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
      cwd="/clone"
      git={{
        readOriginUrl: async () => 'git@github.com:a/b.git',
        remoteDefaultBranch: async () => 'main',
      }}
    />,
    { width: 100, height: 34 },
  )

  const mounted = { client: () => held, setup }
  await frameShowing({ setup, text: 'listing…', within: WITHIN })

  const client = mounted.client()
  if (client === null) throw new Error('the client never mounted')
  client.setCommands([...COMMANDS])
  client.setProjects([
    { id: 'project-1', name: 'b', repo: 'a/b', updatedAt: '2026-11-01T00:00:00.000Z' },
  ])
  client.pushRows([ROW])
  await frameShowing({ setup, text: ROW.title ?? SESSION_ID, within: WITHIN })

  setup.mockInput.pressEnter()
  await frameShowing({ setup, text: 'esc back', within: WITHIN })
  client.pushEvents({
    sessionId: SESSION_ID,
    events: mintEvents({ bodies: [{ type: 'user-said', text: 'open the door' }] }),
    live: true,
  })
  await frameShowing({ setup, text: 'open the door', within: WITHIN })

  return mounted
}

describe('the slash menu in a v2 session', () => {
  test('typing a slash paints the commands and the rows the tui owns', async () => {
    const mounted = await openSession()

    try {
      await mounted.setup.mockInput.typeText('/')

      const frame = await frameShowing({ setup: mounted.setup, text: 'Commands', within: WITHIN })
      expect(frame).toContain('/rewind <message>')
      expect(frame).toContain('/new')
      expect(frame).toContain('/sessions')
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('tab completes the row into the draft', async () => {
    const mounted = await openSession()

    try {
      await mounted.setup.mockInput.typeText('/re')
      await frameShowing({ setup: mounted.setup, text: 'Commands', within: WITHIN })

      mounted.setup.mockInput.pressTab()
      const frame = await frameWhen({
        setup: mounted.setup,
        holds: (drawn) => drawn.includes('/rewind') && !drawn.includes('Commands'),
        describe: 'the completed word and the menu shut',
        within: WITHIN,
      })
      expect(frame).toContain('/rewind')
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('return on a row the tui owns opens the new-session screen', async () => {
    const mounted = await openSession()

    try {
      await mounted.setup.mockInput.typeText('/')
      await frameShowing({ setup: mounted.setup, text: 'Commands', within: WITHIN })

      await mounted.setup.mockInput.typeText('new')
      await frameShowing({ setup: mounted.setup, text: '/new', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameShowing({ setup: mounted.setup, text: 'new session', within: WITHIN })
      expect(mounted.client()?.calls.post).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('return on a row that opens a picker opens the picker', async () => {
    const mounted = await openSession()

    try {
      await mounted.setup.mockInput.typeText('/mod')
      await frameShowing({ setup: mounted.setup, text: 'Commands', within: WITHIN })

      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'MODEL', within: WITHIN })
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('a command with an argument rides as message text, not as a command', async () => {
    const mounted = await openSession()

    try {
      await mounted.setup.mockInput.typeText('/rename tidy')
      await frameShowing({ setup: mounted.setup, text: '/rename tidy', within: WITHIN })

      mounted.setup.mockInput.pressEnter()
      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.post.length ?? 0) === 1,
        describe: 'the message post',
        within: WITHIN,
      })

      expect(mounted.client()?.calls.post[0]?.text).toBe('/rename tidy')
      expect(mounted.client()?.calls.runCommand).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)
})
