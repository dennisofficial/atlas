import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, jest, mock } from 'bun:test'
import { act } from 'react'

import { CLOUD_REQUEST_DEADLINE_MS } from '@/lib/auth-api'

const replace = mock((_href: string) => {})
mock.module('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/threads/abc',
  useSearchParams: () => new URLSearchParams(),
}))

const originalFetch = globalThis.fetch

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  jest.useRealTimers()
  globalThis.fetch = originalFetch
  replace.mockClear()
})

const sessionAnswer = (signedIn: boolean): Response =>
  Response.json(signedIn ? { user: { id: 'u', name: 'Ada', email: 'a@b.c' } } : { user: null })

const accountAnswer = (active: boolean): Response =>
  Response.json({ result: { data: { userId: 'u', email: 'a@b.c', active } } })

const serve = (options: { signedIn: boolean; active?: boolean }): void => {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/v1/trpc/account.me')) return accountAnswer(options.active ?? true)
    return sessionAnswer(options.signedIn)
  }) as unknown as typeof fetch
}

const settle = () => act(async () => new Promise<void>((done) => setTimeout(done, 20)))

const renderGate = async () => {
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
  return { host, root }
}

const mount = async () => {
  const rendered = await renderGate()
  await settle()
  return rendered
}

const hangUntilAborted = (): typeof fetch =>
  mock(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The session check timed out', 'AbortError')),
        )
      }),
  ) as unknown as typeof fetch

const advance = async (ms: number): Promise<void> => {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      jest.advanceTimersByTime(round === 0 ? ms : 0)
    })
  }
}

describe('SessionGate', () => {
  it('renders children when the account has access', async () => {
    serve({ signedIn: true, active: true })
    const { host, root } = await mount()
    expect(host.textContent).toContain('private content')
    await act(async () => root.unmount())
  })

  it('shows the whitelist wall for a signed-in account that is awaiting access', async () => {
    serve({ signedIn: true, active: false })
    const { host, root } = await mount()
    expect(host.textContent).toContain("You're on the list")
    expect(host.textContent).not.toContain('private content')
    expect(replace).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('redirects to sign-in with the current path when signed out', async () => {
    serve({ signedIn: false })
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
    serve({ signedIn: true, active: true })
    const retry = host.querySelector('button')
    await act(async () => retry?.click())
    await settle()
    expect(host.textContent).toContain('private content')
    await act(async () => root.unmount())
  })

  it('shows retry after the deadline when the session check never answers', async () => {
    jest.useFakeTimers()
    globalThis.fetch = hangUntilAborted()
    const { host, root } = await renderGate()
    expect(host.textContent).not.toContain('Could not reach Atlas Cloud')

    await advance(CLOUD_REQUEST_DEADLINE_MS + 1)
    expect(host.textContent).toContain('Could not reach Atlas Cloud')
    expect(host.querySelector('button')).not.toBeNull()

    serve({ signedIn: true, active: true })
    const retry = host.querySelector('button')
    await act(async () => retry?.click())
    await advance(20)
    expect(host.textContent).toContain('private content')
    await act(async () => root.unmount())
  })
})
