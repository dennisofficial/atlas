import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'
import { EGithubPrStatesFrame, type PrStateWire, type WireThread } from '@dltech/atlas-wire/web'

import type { ApiPrStatesSubscribe } from '@/features/threads/data/api-pr-states-source'

import { SidebarPrStatesProvider } from '../shell-sidebar-pr-states'
import { ThreadFamilyProvider, useThreadFamily } from '../shell-thread-family'
import { ThreadRow } from '../shell-thread-row'
import { ThreadList } from '../shell-thread-list'
import { ThreadActionsContext } from '../thread-actions-context'
import { ThreadDetails } from '../thread-details'
import { projectOf, sessionOf, threadOf } from './fixtures'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const pr = (number: number): PrStateWire => ({
  repo: 'acme/atlas',
  number,
  url: `https://github.com/acme/atlas/pull/${number}`,
  branch: 'shared',
  state: 'open',
})

const owner = (id: string, pullRequests: WireThread['pullRequests']): WireThread =>
  threadOf({
    id,
    title: id,
    repo: 'acme/atlas',
    worktree: { path: `/work/${id}`, branch: 'shared' },
    pullRequests,
  })

const mate = owner('mate', [pr(2)])
const rootThread = owner('root', [
  pr(1),
  { ...pr(2), via: { threadId: mate.id, title: mate.title ?? null } },
])
const family: readonly WireThread[] = [rootThread, mate]
const session = sessionOf(rootThread, [sessionOf(mate)])

function FamilyIds() {
  return (
    <output>
      {useThreadFamily()
        .map((thread) => thread.id)
        .join(',')}
    </output>
  )
}

describe('thread family context and rendered ownership pipeline', () => {
  it('defaults to an empty family and preserves the complete supplied family', () => {
    expect(renderToStaticMarkup(<FamilyIds />)).toBe('<output></output>')
    expect(
      renderToStaticMarkup(
        <ThreadFamilyProvider threads={family}>
          <FamilyIds />
        </ThreadFamilyProvider>,
      ),
    ).toBe('<output>root,mate</output>')
  })

  it('merges inherited known threads by id rather than losing other root ownership', () => {
    expect(
      renderToStaticMarkup(
        <ThreadFamilyProvider threads={family}>
          <ThreadFamilyProvider threads={[mate, mate]}>
            <FamilyIds />
          </ThreadFamilyProvider>
        </ThreadFamilyProvider>,
      ),
    ).toBe('<output>root,mate</output>')
  })

  it('keeps details own PRs isolated using known family ownership', () => {
    const html = renderToStaticMarkup(
      <ThreadFamilyProvider threads={family}>
        <ThreadDetails thread={mate} projectName="atlas" states={[pr(1), pr(2), pr(3)]} />
      </ThreadFamilyProvider>,
    )
    expect(html).toContain('acme/atlas#2')
    expect(html).not.toContain('acme/atlas#1')
    expect(html).not.toContain('acme/atlas#3')
  })

  it('keeps other projects and their nested owners known through root-level providers', async () => {
    let handlers: Parameters<ApiPrStatesSubscribe>[0] | undefined
    const subscribe: ApiPrStatesSubscribe = (next) => {
      handlers = next
      return { unsubscribe: () => undefined }
    }
    const first = { ...owner('first', [pr(1)]), updatedAt: new Date().toISOString() }
    const second = { ...owner('second', [pr(2)]), updatedAt: new Date().toISOString() }
    const nested = owner('nested', [pr(3)])
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const row = (id: string) => host.querySelector(`[href="/threads/${id}"]`)
    window.localStorage.clear()
    try {
      await act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
              <ThreadList
                entries={[
                  { project: projectOf('first'), sessions: [sessionOf(first)] },
                  {
                    project: projectOf('second'),
                    sessions: [sessionOf(second, [sessionOf(nested)])],
                  },
                ]}
                activeThreadId="nested"
                subscribe={subscribe}
              />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
      await act(async () => {
        for (const number of [1, 2, 3, 4]) {
          handlers?.onData({
            type: EGithubPrStatesFrame.PrState,
            state: {
              repoFullName: 'acme/atlas',
              prNumber: number,
              title: `Pull request ${number}`,
              url: pr(number).url,
              state: 'open',
              headBranch: 'shared',
              headSha: 'abc',
              updatedAt: '',
            },
          })
        }
      })
      expect(row('first')?.textContent).toContain('#1')
      expect(row('second')?.textContent).toContain('#2')
      expect(row('nested')?.textContent).toContain('#3')
      for (const id of ['first', 'second', 'nested']) {
        expect(row(id)?.textContent).not.toContain('+')
        expect(row(id)?.textContent).not.toContain('#4')
      }
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('does not steal ownership on live updates and collapses to the unique family total', async () => {
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const render = (states: readonly PrStateWire[]) => (
      <SidebarProvider>
        <ThreadActionsContext.Provider value={{ onToggleArchive: () => undefined }}>
          <SidebarPrStatesProvider states={states}>
            <ThreadRow session={session} projectName="atlas" activeThreadId="root" />
          </SidebarPrStatesProvider>
        </ThreadActionsContext.Provider>
      </SidebarProvider>
    )
    const row = (id: string) => host.querySelector(`[href="/threads/${id}"]`)
    window.localStorage.clear()
    try {
      await act(async () => root.render(render([])))
      expect(row('root')?.textContent).toContain('#1')
      expect(row('mate')?.textContent).toContain('#2')
      await act(async () =>
        root.render(
          render([
            { ...pr(1), checksRunning: 0, checksPassed: 4, checksFailed: 0 },
            { ...pr(2), checksRunning: 0, checksPassed: 2, checksFailed: 1 },
            pr(3),
          ]),
        ),
      )
      expect(row('root')?.textContent).toContain('#1')
      expect(row('root')?.textContent).not.toContain('+1')
      expect(row('mate')?.textContent).toContain('#2')
      expect(row('mate')?.textContent).not.toContain('+1')
      expect(
        row('root')?.querySelector('[aria-label="0 running, 4 passed, 0 failed"]'),
      ).not.toBeNull()
      expect(
        row('mate')?.querySelector('[aria-label="0 running, 2 passed, 1 failed"]'),
      ).not.toBeNull()
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-expanded="true"][aria-controls]')?.click(),
      )
      expect(row('mate') === null).toBe(true)
      expect(row('root')?.textContent).toContain('#2')
      expect(row('root')?.textContent).toContain('+1')
      expect(row('root')?.textContent).not.toContain('+2')
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-expanded="false"][aria-controls]')?.click(),
      )
      expect(row('root')?.textContent).toContain('#1')
      expect(row('mate')?.textContent).toContain('#2')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
