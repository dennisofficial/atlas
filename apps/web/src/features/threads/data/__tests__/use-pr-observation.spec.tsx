import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { WireThread } from '@dltech/atlas-wire/web'

import { GithubSection } from '../../panel/details/github-section'
import { EMPTY_DETAILS } from '../../panel/details/details-input'
import { ThreadPanelProvider, type ThreadPanelValue } from '../../panel/thread-panel-context'
import { useApiPrStates } from '../use-api-pr-states'
import { usePullRequests } from '../use-pull-requests'
import { installObservationIntersections, observationSourceRig } from './pr-observation.fixture'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const target = (number: number) => ({ repo: 'owner/repo', number })
const thread: WireThread = {
  id: 'details',
  head: 1,
  createdAt: '',
  updatedAt: '',
  workspace: null,
  repo: 'owner/repo',
  pullRequests: [2, 3].map((number) => ({
    ...target(number),
    url: `https://github.com/owner/repo/pull/${number}`,
    branch: 'topic',
    state: 'open',
  })),
}
const noop = () => {}

function panelOf(pullRequests: ReturnType<typeof usePullRequests>): ThreadPanelValue {
  return {
    threadId: 'details',
    channel: null,
    pod: null,
    details: { ...EMPTY_DETAILS, pullRequests },
    loaded: true,
    error: null,
    working: false,
    changesPath: undefined,
    agentId: undefined,
    contextPath: undefined,
    openChanges: noop,
    openAgent: noop,
    openDetails: noop,
    clearAgent: noop,
    openContextFile: noop,
    toggleContextFile: noop,
    closeContextFile: noop,
    closePanel: noop,
    refreshPod: noop,
  }
}

function elementIn(container: Element): HTMLElement {
  const element = container.querySelector<HTMLElement>('section[aria-label="GitHub"]')
  if (element === null) throw new Error('Missing GitHub details section')
  return element
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('visible Details PR observations', () => {
  it('does not observe an always-mounted hidden pane; unions visible details with sidebar and releases on hide/unmount', async () => {
    const intersections = installObservationIntersections()
    const source = observationSourceRig()
    const { createRoot } = await import('react-dom/client')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    function Sidebar() {
      useApiPrStates({ subscribe: source.subscribe, observe: [target(1)] })
      return null
    }
    function Details({ show }: { show: boolean }) {
      const pullRequests = usePullRequests({
        threadId: 'details',
        channel: null,
        thread,
        subscribe: source.subscribe,
      })
      return (
        <ThreadPanelProvider value={panelOf(pullRequests)}>
          {show ? <GithubSection /> : null}
        </ThreadPanelProvider>
      )
    }
    const render = (show: boolean) =>
      act(async () =>
        root.render(
          <>
            <Sidebar />
            <Details show={show} />
          </>,
        ),
      )
    try {
      setVisibility('visible')
      await render(false)
      expect(source.observations()).toEqual([target(1)])
      expect(source.active()).toBe(1)
      await render(true)
      const section = elementIn(host)
      expect(source.observations()).toEqual([target(1)])
      await act(async () => intersections.emit([{ element: section, visible: true }]))
      expect(source.observations()).toEqual([target(1), target(2), target(3)])
      await act(async () => intersections.emit([{ element: section, visible: false }]))
      expect(source.observations()).toEqual([target(1)])
      await act(async () => intersections.emit([{ element: section, visible: true }]))
      await act(async () => setVisibility('hidden'))
      expect(source.observations()).toEqual([])
      await act(async () => setVisibility('visible'))
      expect(source.observations()).toEqual([target(1)])
      await act(async () => intersections.emit([{ element: section, visible: true }]))
      expect(source.observations()).toEqual([target(1), target(2), target(3)])
      await render(false)
      expect(source.observations()).toEqual([target(1)])
      expect(source.active()).toBe(1)
      expect(source.peak()).toBe(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      intersections.restore()
    }
    expect(source.active()).toBe(0)
  })
})
