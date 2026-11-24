import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'
import { TextareaRenderable } from '@opentui/core'

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

const QUEUED = 'a second thought'

const postedBody = (inboxId: number) =>
  ({
    type: 'input-posted',
    inboxId,
    kind: 'message',
    postedAt: '2026-11-20T00:00:00.000Z',
    message: { text: QUEUED },
  }) as const

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const open = async (): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-chat-queue-'))
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

describe('the queue of a v2 session', () => {
  test('a message the server queued while the turn works is on screen', async () => {
    const mounted = await open()

    try {
      clientOf(mounted).pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({ bodies: [postedBody(3)] }),
        live: true,
      })

      await frameShowing({ setup: mounted.setup, text: QUEUED, within: WITHIN })
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('up takes the queued message back into the draft once the server confirms', async () => {
    const mounted = await open()
    const client = clientOf(mounted)
    const first = mintEvents({ bodies: [postedBody(3)] })

    try {
      client.pushEvents({ sessionId: SESSION_ID, events: first, live: true })
      await frameShowing({ setup: mounted.setup, text: QUEUED, within: WITHIN })

      mounted.setup.mockInput.pressArrow('up')
      await frameWhen({
        setup: mounted.setup,
        holds: () => client.calls.withdraw.length === 1,
        within: WITHIN,
      })

      expect(client.calls.withdraw[0]).toEqual({ sessionId: SESSION_ID, inboxId: 3 })
      expect(editorTextOf(mounted.setup.renderer.root)).toBe('')

      client.pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({
          bodies: [postedBody(3), { type: 'input-withdrawn', inboxId: 3 }],
        }),
        live: true,
      })
      await frameWhen({
        setup: mounted.setup,
        holds: () => editorTextOf(mounted.setup.renderer.root) === QUEUED,
        describe: 'the withdrawn message in the draft',
        within: WITHIN,
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)

  test('a message already taken up by the turn says so and leaves the draft alone', async () => {
    const mounted = await open()
    const client = clientOf(mounted)

    try {
      client.api.withdraw = async (input) => {
        client.calls.withdraw.push(input)
        return { ok: false, reason: 'already-consumed' }
      }
      client.pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({ bodies: [postedBody(3)] }),
        live: true,
      })
      await frameShowing({ setup: mounted.setup, text: QUEUED, within: WITHIN })

      mounted.setup.mockInput.pressArrow('up')
      await frameShowing({ setup: mounted.setup, text: 'Already sent', within: WITHIN })
      expect(client.calls.withdraw).toHaveLength(1)
      expect(editorTextOf(mounted.setup.renderer.root)).toBe('')
    } finally {
      await teardown(mounted.setup)
    }
  }, 30_000)
})
