import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { EVercelCredentialKind, EVercelPlan } from '@dltech/atlas-wire/web'

import type { VercelCredentialView } from '../../shared/vercel-credential'
import { useVercelPlan } from '../use-vercel-plan'

const ENTERPRISE: VercelCredentialView = {
  configured: true,
  kind: EVercelCredentialKind.Token,
  teamId: 'team_abc',
  vercelProjectId: 'prj_abc',
  plan: EVercelPlan.Enterprise,
  planCheckedAt: '2026-11-03T12:00:00.000Z',
  needsReconnect: false,
  oauthConfigured: false,
  updatedAt: '2026-11-03T12:00:00.000Z',
}

let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  await GlobalRegistrator.unregister()
})

function Plan() {
  return <span>{useVercelPlan()}</span>
}

describe('useVercelPlan', () => {
  it('reads the plan from the cache entry the credential card writes', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    queryClient.setQueryData(['user-vercel-credential'], {
      value: { view: ENTERPRISE, fetchedAt: 0 },
    })
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Plan />
        </QueryClientProvider>,
      ),
    )
    expect(container.textContent).toBe(EVercelPlan.Enterprise)
  })
})
