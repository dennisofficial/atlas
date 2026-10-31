import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import { EGithubPrStatesFrame } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'

import { ThreadList } from '../shell-thread-list'
import { ThreadActionsContext } from '../thread-actions-context'
import { sessionOf, threadOf } from './fixtures'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('ThreadList live PR state', () => {
  it('subscribes once and updates visible main and teammate CI from the API stream', async () => {
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
    const linked = {
      repo: 'owner/repo',
      number: 6,
      url: 'https://github.com/owner/repo/pull/6',
      branch: 'sidebar',
      state: 'open',
    }
    const currentThread = (id: string) =>
      threadOf({
        id,
        title: id,
        updatedAt: new Date().toISOString(),
        pullRequests: [linked],
      })
    const parent = sessionOf(currentThread('main'), [sessionOf(currentThread('teammate'))])
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    window.localStorage.clear()
    try {
      await act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
              <ThreadList
                entries={[{ project: null, sessions: [parent] }]}
                activeThreadId="main"
                subscribe={subscribe}
              />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
      expect(opens).toBe(1)
      const main = host.querySelector('[href="/threads/main"]')
      const teammate = host.querySelector('[href="/threads/teammate"]')
      expect(main?.textContent).toContain('#6')
      expect(teammate?.textContent).toContain('#6')
      expect(main?.textContent).toContain('Checks unknown')
      await act(async () =>
        handlers?.onData({
          type: EGithubPrStatesFrame.PrState,
          state: {
            repoFullName: 'owner/repo',
            prNumber: 6,
            title: 'Ship sidebar',
            url: linked.url,
            state: 'open',
            headBranch: 'sidebar',
            headSha: 'abc',
            checksRunning: 0,
            checksPassed: 3,
            checksFailed: 0,
            mergeable: false,
            updatedAt: '',
          },
        }),
      )
      for (const row of [main, teammate]) {
        expect(row?.querySelector('[aria-label="0 running, 3 passed, 0 failed"]')).not.toBeNull()
        expect(row?.querySelector('[aria-label="Merge conflicts"]')).not.toBeNull()
      }
      expect(opens).toBe(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
    expect(closes).toBe(1)
  })
})
