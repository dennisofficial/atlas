import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import '@/lib/__tests__/fake-trpc'
import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

const originalFetch = globalThis.fetch

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('useSessionUser', () => {
  it('shares one get-session request across the gate, sidebar and transcript', async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) =>
      String(input).includes('/v1/trpc/account.me')
        ? Response.json({
            result: { data: { userId: 'u', email: 'ada@example.com', active: true } },
          })
        : Response.json({ user: { name: 'Ada', email: 'ada@example.com' } }),
    )
    const sessionReads = () =>
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/auth/get-session'))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { createRoot } = await import('react-dom/client')
    const { useSessionUser } = await import('../use-session-identity')
    const { useSessionState } = await import('@/features/auth/session-gate')
    const seen: string[] = []

    function Gate() {
      useSessionState()
      return null
    }
    function Consumer() {
      seen.push(useSessionUser().user?.name ?? 'none')
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () =>
      root.render(
        <TestQueryProvider client={createTestQueryClient()}>
          <Gate />
          <Consumer />
          <Consumer />
        </TestQueryProvider>,
      ),
    )
    for (let tick = 0; tick < 100 && !seen.includes('Ada'); tick += 1) {
      await act(async () => new Promise<void>((done) => setTimeout(done, 20)))
    }

    expect(sessionReads()).toHaveLength(1)
    expect(seen).toContain('Ada')
    await act(async () => root.unmount())
  })
})
