import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { EGithubPrStatesFrame } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'
import { useApiPrStates } from '@/features/threads/data/use-api-pr-states'

import { SidebarPrStatesProvider, useSidebarPrStates } from '../shell-sidebar-pr-states'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function Row({ label }: { label: string }) {
  const states = useSidebarPrStates()
  return (
    <p>
      {label}:{states[0]?.checksPassed ?? 'unknown'}
    </p>
  )
}

describe('sidebar PR state context', () => {
  it('allows an isolated row with no source or provider', () => {
    expect(renderToStaticMarkup(<Row label="isolated" />)).toContain('isolated:unknown')
  })

  it('broadcasts live API updates to all rows and shares its connection/cache with details', async () => {
    let handlers: Parameters<ApiPrStatesSubscribe>[0] | undefined
    let opens = 0
    let closes = 0
    const subscribe: ApiPrStatesSubscribe = (next) => {
      handlers = next
      opens += 1
      return {
        unsubscribe: () => {
          closes += 1
        },
      }
    }
    function Sidebar() {
      const states = useApiPrStates({ subscribe })
      return (
        <SidebarPrStatesProvider states={states}>
          <Row label="main" />
          <Row label="teammate" />
          <Row label="archived" />
        </SidebarPrStatesProvider>
      )
    }
    function Details() {
      const states = useApiPrStates({ subscribe })
      return <p>details:{states[0]?.checksPassed ?? 'unknown'}</p>
    }
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    const root = createRoot(host)
    const detailsHost = document.createElement('div')
    const detailsRoot = createRoot(detailsHost)
    const push = (checksPassed: number) =>
      handlers?.onData({
        type: EGithubPrStatesFrame.PrState,
        state: {
          repoFullName: 'owner/repo',
          prNumber: 6,
          title: 'Ship sidebar',
          url: 'https://github.com/owner/repo/pull/6',
          state: 'open',
          headBranch: 'sidebar',
          headSha: 'abc',
          checksRunning: 0,
          checksPassed,
          checksFailed: 0,
          mergeable: true,
          updatedAt: '',
        },
      })
    try {
      await act(async () => root.render(<Sidebar />))
      expect(opens).toBe(1)
      expect(host.textContent).toBe('main:unknownteammate:unknownarchived:unknown')
      await act(async () => push(1))
      expect(host.textContent).toBe('main:1teammate:1archived:1')
      await act(async () => detailsRoot.render(<Details />))
      expect(opens).toBe(1)
      expect(detailsHost.textContent).toBe('details:1')
      await act(async () => push(2))
      expect(host.textContent).toBe('main:2teammate:2archived:2')
      expect(detailsHost.textContent).toBe('details:2')
      await act(async () => detailsRoot.render(null))
      expect(closes).toBe(0)
      await act(async () => push(3))
      expect(host.textContent).toBe('main:3teammate:3archived:3')
    } finally {
      await act(async () => detailsRoot.unmount())
      await act(async () => root.unmount())
    }
    expect(closes).toBe(1)
  })
})
