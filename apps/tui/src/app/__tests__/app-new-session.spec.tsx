import { testRender } from '@opentui/react/test-utils'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { ACCOUNT_FILE_VERSION, writeAccount, type AccountFile } from '../account/account-file'
import { AppNext, type SessionClientFactory } from '../app-next'
import { EOpenMode, type LaunchFlags } from '../launch-flags'
import type { GitRemote } from '../new-session'
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

const launchOf = (model: string | null): LaunchFlags => ({
  open: { mode: EOpenMode.New },
  model,
})

const gitOf = (originUrl: string | null): GitRemote => ({
  readOriginUrl: async () => originUrl,
  remoteDefaultBranch: async () => 'main',
})

type Mounted = {
  client: () => FakeSessionClient | null
  setup: Awaited<ReturnType<typeof testRender>>
}

const mount = async (args: { launch: LaunchFlags; git: GitRemote }): Promise<Mounted> => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-app-new-session-'))
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
      launch={args.launch}
      cwd="/clone"
      git={args.git}
    />,
    { width: 100, height: 30 },
  )

  await frameShowing({ setup, text: 'listing…', within: WITHIN })
  return { client: () => held, setup }
}

describe('the new-session screen', () => {
  test('a matching remote creates on the first message with no project prompt', async () => {
    const mounted = await mount({
      launch: launchOf('anthropic/claude-opus-5-5'),
      git: gitOf('git@github.com:a/b.git'),
    })

    try {
      mounted
        .client()
        ?.setProjects([
          { id: 'project-1', name: 'b', repo: 'a/b', updatedAt: '2026-11-01T00:00:00.000Z' },
        ])
      mounted.client()?.pushCreated({ sessionId: 'session-made', mainThreadId: 'thread-1' })

      mounted.setup.mockInput.pressKey('n', { ctrl: true })
      await frameShowing({ setup: mounted.setup, text: 'new session', within: WITHIN })

      await mounted.setup.mockInput.typeText('hello')
      mounted.setup.mockInput.pressEnter()

      await frameShowing({ setup: mounted.setup, text: 'session-made', within: WITHIN })

      const calls = mounted.client()?.calls
      expect(calls?.createProject).toHaveLength(0)
      expect(calls?.createSession).toEqual([
        {
          projectId: 'project-1',
          model: 'anthropic/claude-opus-5-5',
          effort: 'medium',
          firstMessage: { text: 'hello' },
        },
      ])
    } finally {
      await teardown(mounted.setup)
    }
  })

  test('an unmatched remote opens the create drawer and the new project carries the session', async () => {
    const mounted = await mount({
      launch: launchOf(null),
      git: gitOf('git@github.com:no/such.git'),
    })

    try {
      mounted.client()?.pushCreated({ sessionId: 'session-made', mainThreadId: 'thread-1' })

      mounted.setup.mockInput.pressKey('n', { ctrl: true })
      await frameShowing({ setup: mounted.setup, text: 'new session', within: WITHIN })

      await mounted.setup.mockInput.typeText('hello')
      mounted.setup.mockInput.pressEnter()

      await frameShowing({
        setup: mounted.setup,
        text: 'CREATE A PROJECT FOR THIS REPOSITORY',
        within: WITHIN,
      })
      mounted.setup.mockInput.pressEnter()

      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.createSession.length ?? 0) === 1,
        describe: 'the session to be created',
        within: WITHIN,
      })
      await frameShowing({ setup: mounted.setup, text: 'session-made', within: WITHIN })

      const calls = mounted.client()?.calls
      expect(calls?.createProject).toEqual([
        { name: 'such', repo: 'no/such', baseBranch: 'main', additionalRepos: [] },
      ])
      expect(calls?.createSession[0]?.projectId).toBe('project-1')
    } finally {
      await teardown(mounted.setup)
    }
  })
})
