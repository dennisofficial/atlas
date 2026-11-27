import { describe, expect, test } from 'bun:test'

import {
  EClientAction,
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  type CommandEntry,
} from '@dltech/atlas-commands'
import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameSettled, frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'
import type { McpOauthServer } from '../session-api'
import { accountRowOf } from './fake-session-client'

const entry = (name: string, opens: EClientAction): CommandEntry => ({
  name,
  summary: `${name} summary`,
  group: ECommandGroup.Workspace,
  kind: ECommandEntryKind.Command,
  source: ECommandSource.Builtin,
  opens,
})

const COMMANDS: readonly CommandEntry[] = [
  entry('skills', EClientAction.Skills),
  entry('mcp', EClientAction.Mcp),
  entry('shells', EClientAction.Shells),
]

const SIGN_IN = mintEvents({
  bodies: [
    { type: 'user-said', text: 'check linear' },
    {
      type: 'mcp-sign-in-started',
      server: 'linear',
      url: 'https://mcp.example.test/authorize',
      sessionId: SESSION_ID,
    } as never,
  ],
})

const SHELL_STARTED = mintEvents({
  bodies: [
    { type: 'user-said', text: 'run the tests' },
    {
      type: 'background-shell-started',
      shellId: 'sh-1',
      command: 'bun test',
      description: 'the test run',
    },
  ],
})

const run = async (
  mounted: Awaited<ReturnType<typeof openSession>>,
  name: string,
): Promise<void> => {
  await mounted.setup.mockInput.typeText(`/${name}`)
  mounted.setup.mockInput.pressEnter()
}

describe('the skills panel', () => {
  test('/skills lists the catalogue and puts a skill in the composer', async () => {
    const opened: string[] = []
    const mounted = await openSession({
      onOpenUrl: (url) => void opened.push(url),
      configure: (client) => {
        client.setCommands(COMMANDS)
        client.setSkills([{ name: 'review', summary: 'review a branch' }])
      },
    })

    try {
      await run(mounted, 'skills')
      const frame = await frameShowing({ setup: mounted.setup, text: 'skills', within: WITHIN })
      expect(frame).toContain('/review')

      mounted.setup.mockInput.pressEnter()
      await frameWhen({
        setup: mounted.setup,
        holds: (shown) => shown.includes('/review'),
        within: WITHIN,
        describe: 'the skill to land in the composer',
      })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})

describe('the mcp panel', () => {
  test('/mcp lists the roster and begins a sign-in for a server it knows', async () => {
    const opened: string[] = []
    const mounted = await openSession({
      onOpenUrl: (url) => void opened.push(url),
      configure: (client) => {
        client.setCommands(COMMANDS)
        client.setMcpServers([
          {
            id: 'mcp_1',
            name: 'linear',
            source: 'cloud',
            url: 'https://mcp.example.test',
            status: 'none',
          } as McpOauthServer,
        ])
      },
    })

    try {
      mounted.client()?.pushEvents({
        sessionId: SESSION_ID,
        events: mintEvents({
          bodies: [
            { type: 'user-said', text: 'check linear' },
            {
              type: 'mcp-server-changed',
              row: {
                name: 'linear',
                transport: 'http',
                status: 'needs-auth',
                toolCount: 2,
                layer: 'user',
              },
            } as never,
          ],
        }),
        live: true,
      })
      await run(mounted, 'mcp')
      const frame = await frameShowing({ setup: mounted.setup, text: 'linear', within: WITHIN })
      expect(frame).toContain('needs-auth')
      await frameWhen({
        setup: mounted.setup,
        holds: () => (mounted.client()?.calls.mcpServers ?? 0) > 0,
        within: WITHIN,
        describe: 'the server ids to load',
      })
      await frameSettled({ setup: mounted.setup })

      mounted.setup.mockInput.pressEnter()
      await frameWhen({
        setup: mounted.setup,
        holds: () => mounted.client()?.calls.mcpOauthBegin.length === 1,
        within: WITHIN,
        describe: 'the sign-in to begin',
      })
      expect(mounted.client()?.calls.mcpOauthBegin[0]?.serverId).toBe('mcp_1')
      expect(opened).toContain('https://mcp.example.test/authorize')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('/mcp shows an unresolved sign-in as a link row', async () => {
    const mounted = await openSession({
      configure: (client) => {
        client.setCommands(COMMANDS)
        client.setMcpServers([])
      },
    })

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SIGN_IN, live: true })
      await run(mounted, 'mcp')
      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'sign in to linear',
        within: WITHIN,
      })
      expect(frame).toContain('https://mcp.example.test/authorize')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})

describe('the shells command', () => {
  test('/shells opens the shells drawer', async () => {
    const mounted = await openSession({
      configure: (client) => {
        client.setCommands(COMMANDS)
      },
    })

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SHELL_STARTED, live: true })
      await frameShowing({ setup: mounted.setup, text: 'the test run', within: WITHIN })

      await run(mounted, 'shells')
      await frameShowing({ setup: mounted.setup, text: 'SHELL LOG', within: WITHIN })
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})

describe('an account row the fake serves', () => {
  test('is an account the drawer can show', () => {
    expect(accountRowOf({ id: 'account-1', provider: 'anthropic' }).provider).toBe('anthropic')
  })
})
