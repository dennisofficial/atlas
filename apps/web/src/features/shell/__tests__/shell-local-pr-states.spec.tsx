import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { SidebarProvider } from '@dltech/atlas-ui/components/sidebar'

import { ELocalPodState, type LocalPod } from '@/features/desktop/desktop-wire'
import { localThreadOf, withLocalPods } from '@/features/desktop/local-thread'
import {
  installObservationIntersections,
  observationSourceRig,
} from '@/features/threads/data/__tests__/pr-observation.fixture'

import { ThreadList } from '../shell-thread-list'
import { ThreadActionsContext } from '../thread-actions-context'
import type { ProjectThreads } from '../thread-partition'
import { projectOf, sessionOf, threadOf } from './fixtures'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const project = projectOf('project_mac')
const pod: LocalPod = {
  threadId: 'brn_local',
  projectId: project.id,
  title: 'Host local work',
  createdAt: new Date().toISOString(),
  state: ELocalPodState.Running,
}
const pr = (number: number) => ({
  number,
  repo: 'owner/repo',
  url: `https://github.com/owner/repo/pull/${number}`,
  branch: 'topic',
  state: 'open',
})

function elementIn(args: { container: Element; selector: string }): HTMLElement {
  const element = args.container.querySelector<HTMLElement>(args.selector)
  if (element === null) throw new Error(`Missing ${args.selector}`)
  return element
}

describe('Mac sidebar app-level cloud isolation', () => {
  it('renders actual withLocalPods/localThreadOf data and empty lists without opening a cloud PR stream', async () => {
    const source = observationSourceRig()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const entries = withLocalPods({ entries: [{ project, sessions: [] }], pods: [pod] })
    expect(entries[0]?.sessions[0]?.mainThread).toEqual(localThreadOf(pod))
    const render = (rows: readonly ProjectThreads[]) =>
      act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => {} }}>
              <ThreadList entries={rows} activeThreadId={null} subscribe={source.subscribe} />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
    try {
      await render([])
      expect(source.connections).toHaveLength(0)
      await render(entries)
      expect(
        elementIn({ container, selector: 'a[href="/threads/brn_local"]' }).textContent,
      ).toContain('Host local work')
      expect(source.connections).toHaveLength(0)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  it('shares one cloud stream for mixed rows but never observes the local row or its shown card', async () => {
    const source = observationSourceRig()
    const intersections = installObservationIntersections()
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const cloud = threadOf({
      id: 'cloud',
      title: 'Cloud work',
      updatedAt: new Date().toISOString(),
      pullRequests: [pr(1)],
    })
    const entries = withLocalPods({
      entries: [{ project, sessions: [sessionOf(cloud)] }],
      pods: [pod],
    }).map((entry) => ({
      ...entry,
      sessions: entry.sessions.map((session) =>
        session.mainThread.runner === 'local'
          ? { ...session, mainThread: { ...session.mainThread, pullRequests: [pr(901)] } }
          : session,
      ),
    }))
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    try {
      await act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => {} }}>
              <ThreadList entries={entries} activeThreadId={null} subscribe={source.subscribe} />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
      expect(source.connections).toHaveLength(1)
      const local = elementIn({ container, selector: 'a[href="/threads/brn_local"]' })
      const remote = elementIn({ container, selector: 'a[href="/threads/cloud"]' })
      await act(async () =>
        intersections.emit([
          { element: local, visible: true },
          { element: remote, visible: true },
        ]),
      )
      expect(source.observations()).toEqual([{ repo: 'owner/repo', number: 1 }])
      const details = local.parentElement?.querySelector<HTMLButtonElement>(
        'button[aria-label="Thread details"]',
      )
      if (details === null || details === undefined) throw new Error('Missing local details button')
      await act(async () => details.click())
      const card = elementIn({
        container: document.body,
        selector: '[data-slot="popover-content"] section[aria-label="Scrollable thread details"]',
      })
      expect(card.textContent).toContain('owner/repo#901')
      await act(async () => intersections.emit([{ element: card, visible: true }]))
      expect(source.observations()).toEqual([{ repo: 'owner/repo', number: 1 }])
      expect(source.active()).toBe(1)
      expect(source.peak()).toBe(1)
      const connections = source.connections.length
      const localEntries = entries.map((entry) => ({
        ...entry,
        sessions: entry.sessions.filter((session) => session.mainThread.runner === 'local'),
      }))
      await act(async () =>
        root.render(
          <SidebarProvider>
            <ThreadActionsContext.Provider value={{ onToggleArchive: () => {} }}>
              <ThreadList
                entries={localEntries}
                activeThreadId={null}
                subscribe={source.subscribe}
              />
            </ThreadActionsContext.Provider>
          </SidebarProvider>,
        ),
      )
      expect(source.active()).toBe(0)
      expect(source.connections).toHaveLength(connections)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      intersections.restore()
    }
    expect(source.active()).toBe(0)
  })
})
