import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

const replace = mock((_href: string) => {})
mock.module('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/threads/abc',
  useSearchParams: () => new URLSearchParams(),
}))

const originalFetch = globalThis.fetch

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  replace.mockClear()
})

const respond = (body: unknown, status = 200) => {
  globalThis.fetch = mock(async () => Response.json(body, { status })) as unknown as typeof fetch
}

const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 20)))

const mount = async () => {
  const { createTestQueryClient, TestQueryProvider } = await import(
    '@/lib/__tests__/query-test-provider'
  )
  const client = createTestQueryClient()
  const { createRoot } = await import('react-dom/client')
  const { SessionGate } = await import('../session-gate')
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <TestQueryProvider client={client}>
        <SessionGate>private content</SessionGate>
      </TestQueryProvider>,
    ),
  )
  await settle()
  return { host, root }
}

describe('SessionGate', () => {
  it('renders children when a user is present', async () => {
    respond({ user: { id: 'u' } })
    const { host, root } = await mount()
    expect(host.textContent).toContain('private content')
    await act(async () => root.unmount())
  })

  it('redirects to sign-in with the current path when signed out', async () => {
    respond({ user: null })
    const { host, root } = await mount()
    expect(host.textContent).not.toContain('private content')
    expect(replace).toHaveBeenCalledWith('/sign-in?next=%2Fthreads%2Fabc')
    await act(async () => root.unmount())
  })

  it('shows an error with retry when the API is unreachable, then recovers', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const { host, root } = await mount()
    expect(host.textContent).toContain('Could not reach Atlas Cloud')
    respond({ user: { id: 'u' } })
    const retry = host.querySelector('button')
    await act(async () => retry?.click())
    await settle()
    expect(host.textContent).toContain('private content')
    await act(async () => root.unmount())
  })
})
