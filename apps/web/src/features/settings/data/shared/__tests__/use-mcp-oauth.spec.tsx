import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { mcpSignInsAwaitingResult } from '../mcp-signin-attempts'

const STATE = 'state-1'
const START_URL = `https://api.example.test/return/start/${STATE}`

const opened: string[] = []

let originalFetch: typeof fetch = globalThis.fetch
let originalOpen: typeof window.open

const answeringFetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('mcpOauth.servers')) return Response.json({ result: { data: { servers: [] } } })
  return Response.json({
    result: {
      data: { outcome: 'redirect', authorizationUrl: START_URL },
    },
  })
}) as typeof fetch

const { useMcpOauth } = await import('../use-mcp-oauth')

type Probe = { auth: ReturnType<typeof useMcpOauth> | null }

const probe: Probe = { auth: null }

function Panel() {
  probe.auth = useMcpOauth()
  return <div>{probe.auth.stateOf(undefined)}</div>
}

let root: Root | null = null
let client: QueryClient | null = null

const flush = async (work: () => void): Promise<void> => {
  await act(async () => {
    work()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  originalFetch = globalThis.fetch
  originalOpen = window.open
  globalThis.fetch = answeringFetch
  window.open = ((href: string) => {
    opened.push(href)
    return null
  }) as typeof window.open
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  window.open = originalOpen
  await unregisterDom()
})

beforeEach(() => {
  opened.length = 0
  probe.auth = null
})

afterEach(async () => {
  const mounted = root
  if (mounted !== null) await act(async () => mounted.unmount())
  root = null
  client = null
})

async function mount(): Promise<void> {
  const { createRoot } = await import('react-dom/client')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const held = client
  root = createRoot(document.createElement('div'))
  const mounted = root
  await act(async () =>
    mounted.render(
      <QueryClientProvider client={held}>
        <Panel />
      </QueryClientProvider>,
    ),
  )
}

const authOf = (): ReturnType<typeof useMcpOauth> => {
  if (probe.auth === null) throw new Error('the hook never mounted')
  return probe.auth
}

describe('useMcpOauth', () => {
  it('opens the start link from the begin call through the browser-return opener', async () => {
    await mount()

    await flush(() => authOf().signIn({ serverId: 'srv_1', label: 'mcp.example.com' }))

    expect(opened).toEqual([`${START_URL}?surface=web`])
  })

  it('remembers the server label under the state so the page can toast the result', async () => {
    await mount()

    await flush(() => authOf().signIn({ serverId: 'srv_1', label: 'mcp.example.com' }))

    expect(mcpSignInsAwaitingResult()).toContainEqual({ state: STATE, label: 'mcp.example.com' })
  })

  it('leaves the sign-in control idle afterwards, because the page no longer navigates away', async () => {
    await mount()

    await flush(() => authOf().signIn({ serverId: 'srv_1', label: 'mcp.example.com' }))

    expect(authOf().isBusy('srv_1')).toBe(false)
  })
})
