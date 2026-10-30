import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { act } from 'react'

import { createTestQueryClient, TestQueryProvider } from '@/lib/__tests__/query-test-provider'

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
})

describe('useSessionUser', () => {
  it('shares one get-session request across the gate, sidebar and transcript', async () => {
    const fetchMock = mock(async () =>
      Response.json({ user: { name: 'Ada', email: 'ada@example.com' } }),
    )
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
    await act(async () => new Promise<void>((done) => setTimeout(done, 20)))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(seen).toContain('Ada')
    await act(async () => root.unmount())
  })
})
