import {
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { mintEvents, headOf } from '@dltech/atlas-client/stream-fixture'
import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { TextareaRenderable } from '@opentui/core'
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

const HEADING = 'Rewind'

const REFUSED = 'that rewind was refused'

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

const FIRST = 'build the parser'

const SECOND = 'now the lexer'

const LOG = mintEvents({
  bodies: [
    { type: 'user-said', text: FIRST },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'on it' }] },
    { type: 'assistant-said', parts: [{ type: 'text', text: 'still on it' }] },
    { type: 'user-said', text: SECOND },
  ],
})

const REWOUND = LOG.slice(1)

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const openSession = async (): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-rewind-'))
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

const editorTextOf = (node: {
  getChildren: () => readonly unknown[]
  plainText?: string
}): string => {
  if (node instanceof TextareaRenderable) return node.plainText
  for (const child of node.getChildren()) {
    const found = editorTextOf(child as Parameters<typeof editorTextOf>[0])
    if (found !== '') return found
  }
  return ''
}

const openDrawer = async (mounted: Mounted): Promise<void> => {
  await mounted.setup.mockInput.typeText('/rewind')
  await frameShowing({ setup: mounted.setup, text: '/rewind', within: WITHIN })
  mounted.setup.mockInput.pressEnter()
  await frameShowing({ setup: mounted.setup, text: HEADING, within: WITHIN })
}

describe('the rewind drawer', () => {
  test('opens on a bare slash rewind and posts nothing', async () => {
    const mounted = await openSession()

    try {
      await openDrawer(mounted)

      const frame = await frameShowing({ setup: mounted.setup, text: FIRST, within: WITHIN })
      expect(frame).toContain(SECOND)
      expect(mounted.client()?.calls.post).toEqual([])
      expect(mounted.client()?.calls.runCommand).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('offers rewind and summarise, since fork was dropped', async () => {
    const mounted = await openSession()

    try {
      await openDrawer(mounted)
      mounted.setup.mockInput.pressEnter()

      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'rewind to here',
        within: WITHIN,
      })
      expect(frame).toContain('summarise up to here')
      expect(frame).not.toContain('fork')
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('rewinds to the chosen message and returns it to the composer', async () => {
    const mounted = await openSession()

    try {
      await openDrawer(mounted)

      mounted.setup.mockInput.pressArrow('up')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'rewind to here', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) === 1,
        describe: 'the rewind command',
        within: WITHIN,
      })

      expect(mounted.client()?.calls.runCommand).toEqual([
        { sessionId: SESSION_ID, name: 'rewind', args: { toSeq: 1 } },
      ])

      mounted.client()?.pushReset({ sessionId: SESSION_ID })
      mounted.client()?.pushEvents({
        sessionId: SESSION_ID,
        events: REWOUND,
        live: true,
      })

      await frameWhen({
        setup: mounted.setup,
        holds: () => editorTextOf(mounted.setup.renderer.root) === FIRST,
        describe: 'the rewound message to come back into the composer',
        within: WITHIN,
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('merges the rewound message in front of what the operator typed meanwhile', async () => {
    const mounted = await openSession()

    try {
      await openDrawer(mounted)

      mounted.setup.mockInput.pressArrow('up')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'rewind to here', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) === 1,
        describe: 'the rewind command',
        within: WITHIN,
      })

      await frameWhen({
        setup: mounted.setup,
        holds: (frame) => !frame.includes('Rewind'),
        describe: 'the drawer to close',
        within: WITHIN,
      })
      await mounted.setup.mockInput.typeText('and the parser')
      await frameShowing({ setup: mounted.setup, text: 'and the parser', within: WITHIN })

      mounted.client()?.pushReset({ sessionId: SESSION_ID })
      mounted.client()?.pushEvents({
        sessionId: SESSION_ID,
        events: REWOUND,
        live: true,
      })

      const merged = `${FIRST}\n\nand the parser`
      await frameWhen({
        setup: mounted.setup,
        holds: () => editorTextOf(mounted.setup.renderer.root) === merged,
        describe: 'the merged draft',
        within: WITHIN,
      })
      mounted.setup.mockInput.pressEnter()
      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.post.length ?? 0) === 1,
        describe: 'the merged draft to post',
        within: WITHIN,
      })

      expect(mounted.client()?.calls.post[0]?.text).toBe(merged)
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('a refused rewind leaves the draft alone and says so', async () => {
    const mounted = await openSession()

    try {
      await openDrawer(mounted)

      mounted.setup.mockInput.pressArrow('up')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({ setup: mounted.setup, text: 'rewind to here', within: WITHIN })
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) === 1,
        describe: 'the rewind command',
        within: WITHIN,
      })
      const inboxId = mounted.client()?.calls.runCommand.length ?? 0

      mounted.client()?.pushEvents({
        sessionId: SESSION_ID,
        events: [
          ...LOG,
          ...mintEvents({
            bodies: [{ type: 'input-refused', inboxId, reason: 'no' }],
            runId: 'run-2',
            from: headOf(LOG),
          }),
        ],
        live: true,
      })

      await frameShowing({ setup: mounted.setup, text: REFUSED, within: WITHIN })
      expect(editorTextOf(mounted.setup.renderer.root)).toBe('')
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)
})
