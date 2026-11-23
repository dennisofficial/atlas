import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { StreamSessionRow } from '@dltech/atlas-protocol'

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

const mount = async (): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-model-picker-'))
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
    { width: 100, height: 30 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })
  return { client: () => held, setup }
}

const openSession = async (mounted: Mounted): Promise<void> => {
  mounted.client()?.pushRows([ROW])
  await frameShowing({ setup: mounted.setup, text: ROW.title ?? SESSION_ID, within: WITHIN })
  mounted.setup.mockInput.pressEnter()
  await frameShowing({ setup: mounted.setup, text: 'esc back', within: WITHIN })
}

const waitFor = async (args: {
  setup: Mounted['setup']
  holds: () => boolean
  describe: string
}): Promise<void> => {
  await frameWhen({
    setup: args.setup,
    holds: () => args.holds(),
    describe: args.describe,
    within: WITHIN,
  })
}

describe('the model picker', () => {
  test('ctrl+p draws the providers and a pick posts model-set', async () => {
    const mounted = await mount()

    try {
      await openSession(mounted)

      mounted.setup.mockInput.pressKey('p', { ctrl: true })
      const frame = await frameShowing({ setup: mounted.setup, text: 'MODEL', within: WITHIN })
      expect(frame).toContain('Anthropic')

      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()

      await waitFor({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) === 1,
        describe: 'the model-set call',
      })

      expect(mounted.client()?.calls.runCommand).toEqual([
        {
          sessionId: SESSION_ID,
          name: 'model-set',
          args: { model: 'anthropic/claude-opus-5-5', effort: 'high' },
        },
      ])
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('tab carries fast mode on the pick', async () => {
    const mounted = await mount()

    try {
      await openSession(mounted)

      mounted.setup.mockInput.pressKey('p', { ctrl: true })
      await frameShowing({ setup: mounted.setup, text: 'MODEL', within: WITHIN })
      mounted.setup.mockInput.pressTab()
      mounted.setup.mockInput.pressEnter()

      await waitFor({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.runCommand.length ?? 0) === 1,
        describe: 'the model-set call',
      })

      expect(mounted.client()?.calls.runCommand[0]?.args).toEqual({
        model: 'anthropic/claude-sonnet-4-5',
        effort: 'high',
        fast: true,
      })
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('a pick on the new-session screen rides in the create instead of a command', async () => {
    const mounted = await mount()

    try {
      mounted.client()?.pushCreated({ sessionId: 'session-made', mainThreadId: 'thread-1' })
      mounted
        .client()
        ?.setProjects([
          { id: 'project-1', name: 'b', repo: 'a/b', updatedAt: '2026-11-01T00:00:00.000Z' },
        ])

      mounted.setup.mockInput.pressKey('n', { ctrl: true })
      await frameShowing({ setup: mounted.setup, text: 'new session', within: WITHIN })

      mounted.setup.mockInput.pressKey('p', { ctrl: true })
      await frameShowing({ setup: mounted.setup, text: 'MODEL', within: WITHIN })
      mounted.setup.mockInput.pressArrow('down')
      mounted.setup.mockInput.pressEnter()
      await frameShowing({
        setup: mounted.setup,
        text: 'anthropic/claude-opus-5-5',
        within: WITHIN,
      })

      await mounted.setup.mockInput.typeText('hello')
      mounted.setup.mockInput.pressEnter()

      await waitFor({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.createSession.length ?? 0) === 1,
        describe: 'the session to be created',
      })

      expect(mounted.client()?.calls.runCommand).toHaveLength(0)
      expect(mounted.client()?.calls.createSession[0]?.model).toBe('anthropic/claude-opus-5-5')
    } finally {
      await teardown(mounted.setup)
    }
  })
})
