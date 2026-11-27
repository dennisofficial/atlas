import { afterEach, describe, expect, it } from 'bun:test'

import { browserReturns } from '@dltech/atlas-client/browser-return'
import { EReturnResult } from '@dltech/atlas-core'
import { MCP_VIEW } from '@dltech/atlas-plugin-mcp/core'

import { mountProbe, type Mounted } from '../../ui/hooks/__tests__/mention-reader-fixture'
import type { OpenBrowserReturn } from '../browser-return/open'
import { useMcpPanel, type McpPanel, type McpPanelApi } from '../mcp-panel'
import type { McpOauthBeginResult, McpOauthServer } from '../session-api'

const START_URL = 'https://api.example.test/return/start/state-1'

const SERVER = {
  id: 'mcp_1',
  name: 'linear',
  source: 'cloud',
  url: 'https://mcp.example.test',
  status: 'none',
} as McpOauthServer

const VIEWS = {
  [MCP_VIEW]: [
    { name: 'linear', transport: 'http', status: 'needs-auth', toolCount: 2, layer: 'user' },
  ],
}

type Probe = {
  panel: McpPanel | null
  urls: string[]
  problems: string[]
  opened: OpenBrowserReturn[]
}

const moved: Probe = { panel: null, urls: [], problems: [], opened: [] }

function Panel(props: { api: McpPanelApi }) {
  const panel = useMcpPanel({
    api: props.api,
    views: VIEWS,
    events: [],
    openUrl: (url) => void moved.urls.push(url),
    onProblem: (reason) => void moved.problems.push(reason),
    openSignIn: (args) => void moved.opened.push(args),
  })
  moved.panel = panel
  return <text>{panel.rows.map((row) => row.label).join(' | ')}</text>
}

type Harness = Mounted<{ api: McpPanelApi }>

const harnesses: Harness[] = []

const control = (): McpPanel => {
  if (moved.panel === null) throw new Error('the panel never mounted')
  return moved.panel
}

const settle = async (harness: Harness): Promise<void> => {
  await harness.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const apiOf = (args: { startUrl: string; count: { servers: number } }): McpPanelApi => ({
  mcpServers: async () => {
    args.count.servers += 1
    return [SERVER]
  },
  mcpOauthBegin: async () =>
    ({ outcome: 'redirect', authorizationUrl: args.startUrl }) as McpOauthBeginResult,
})

async function openedPanel(args: {
  startUrl: string
  count: { servers: number }
}): Promise<Harness> {
  moved.panel = null
  moved.urls = []
  moved.problems = []
  moved.opened = []
  const api = apiOf(args)
  const harness = await mountProbe<{ api: McpPanelApi }>({
    render: (props) => <Panel {...props} />,
    props: { api },
  })
  harnesses.push(harness)
  await harness.act(() => control().handleOpen())
  await settle(harness)
  return harness
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.done()
})

describe('the mcp panel sign-in', () => {
  it('opens the start link through the loopback opener and shows the result', async () => {
    const count = { servers: 0 }
    const harness = await openedPanel({ startUrl: START_URL, count })
    expect(control().rows.map((row) => row.label)).toContain('linear')

    await harness.act(() => control().handlePick(0))
    await settle(harness)

    expect(moved.opened).toHaveLength(1)
    expect(moved.opened[0]?.url).toBe(START_URL)
    expect(moved.opened[0]?.copy.connected).toBe('Signed in to linear')
    expect(moved.opened[0]?.copy.failed('denied')).toBe('Could not sign in to linear: denied')
    expect(control().rows.map((row) => row.label)).toContain('signing in to linear')

    await harness.act(() => {
      browserReturns.remember({
        state: 'state-1',
        outcome: { result: EReturnResult.Connected },
      })
    })
    await settle(harness)

    expect(control().rows.map((row) => row.label)).toContain('signed in to linear')
    expect(count.servers).toBe(2)
  }, 30_000)

  it('shows a failed result with its reason', async () => {
    const harness = await openedPanel({
      startUrl: 'https://api.example.test/return/start/state-2',
      count: { servers: 0 },
    })

    await harness.act(() => control().handlePick(0))
    await settle(harness)
    await harness.act(() => {
      browserReturns.remember({
        state: 'state-2',
        outcome: { result: EReturnResult.Failed, reason: 'access_denied' },
      })
    })
    await settle(harness)

    const failed = control().rows.find((row) => row.key === 'sign-in:result')
    expect(failed?.label).toBe('could not sign in to linear')
    expect(failed?.detail).toBe('access_denied')
  }, 30_000)

  it('reports a begin call the api refuses without opening the browser', async () => {
    moved.panel = null
    moved.problems = []
    moved.opened = []
    const api: McpPanelApi = {
      mcpServers: async () => [SERVER],
      mcpOauthBegin: async () =>
        ({
          outcome: 'unsupported',
          reason: 'the server has no oauth metadata',
        }) as McpOauthBeginResult,
    }
    const harness = await mountProbe<{ api: McpPanelApi }>({
      render: (props) => <Panel {...props} />,
      props: { api },
    })
    harnesses.push(harness)
    await harness.act(() => control().handleOpen())
    await settle(harness)

    await harness.act(() => control().handlePick(0))
    await settle(harness)

    expect(moved.opened).toHaveLength(0)
    expect(moved.problems).toEqual(['the server has no oauth metadata'])
  }, 30_000)
})
