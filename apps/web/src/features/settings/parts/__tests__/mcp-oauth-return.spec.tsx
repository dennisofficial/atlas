import { GlobalRegistrator } from '@happy-dom/global-registrator'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { toast } from 'sonner'

const replace = mock((_href: string) => {})
const createToastSpies = () => ({
  success: spyOn(toast, 'success').mockImplementation(() => 0),
  error: spyOn(toast, 'error').mockImplementation(() => 0),
})
let toastSpies: ReturnType<typeof createToastSpies>
let query = ''

mock.module('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/settings/integrations',
  useSearchParams: () => new URLSearchParams(query),
}))

let root: Root | null = null

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

beforeEach(() => {
  toastSpies = createToastSpies()
})

afterEach(async () => {
  try {
    const mounted = root
    if (mounted !== null) await act(async () => mounted.unmount())
  } finally {
    root = null
    replace.mockClear()
    toastSpies.success.mockRestore()
    toastSpies.error.mockRestore()
  }
})

async function mount(search: string, reload: () => void) {
  query = search
  const { McpOauthReturn } = await import('../mcp-oauth-return')
  const { createRoot } = await import('react-dom/client')
  root = createRoot(document.createElement('div'))
  const mounted = root
  await act(async () => mounted.render(<McpOauthReturn reload={reload} />))
}

describe('McpOauthReturn', () => {
  it('toasts success, strips only the mcp params and reloads', async () => {
    const reload = mock(() => {})
    await mount('?mcpOauth=connected&mcpServer=https%3A%2F%2Fmcp.example.com%2Fmcp&keep=1', reload)

    expect(toastSpies.success).toHaveBeenCalledWith('Signed in to mcp.example.com')
    expect(replace).toHaveBeenCalledWith('/settings/integrations?keep=1')
    expect(reload).toHaveBeenCalled()
  })

  it('toasts failure with the reason', async () => {
    await mount('?mcpOauth=failed&mcpServer=https%3A%2F%2Fa.test%2Fmcp&mcpReason=denied', () => {})

    expect(toastSpies.error).toHaveBeenCalledWith("Couldn't sign in to a.test: denied")
    expect(replace).toHaveBeenCalledWith('/settings/integrations')
  })

  it('does nothing without return params', async () => {
    await mount('?other=1', () => {})

    expect(replace).not.toHaveBeenCalled()
  })
})
