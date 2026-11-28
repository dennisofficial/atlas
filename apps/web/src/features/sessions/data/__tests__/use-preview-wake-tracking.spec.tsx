import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { EPodPowerPhase } from '@dltech/atlas-core'

import { openBrowserUrl } from '@/features/sessions/panel/browser/open-browser'
import { closeTab } from '@/features/threads/data/preview-browser/browser-model'
import { EPreviewWait } from '@/features/threads/data/preview-browser/preview-wake'
import {
  resetPreviewBrowsers,
  updatePreviewBrowser,
} from '@/features/threads/data/preview-browser/use-preview-browser'
import {
  changeRegistry,
  hidden,
  resetFrameRegistry,
  shown,
} from '@/features/threads/panel/preview/frame-registry'
import { reportPreviewDocument } from '@/features/threads/panel/preview/preview-document-reports'
import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { initAnalytics, resetAnalyticsForTests } from '@/lib/analytics/analytics'

import { usePreviewWakeTracking } from '../use-preview-wake-tracking'

const URL = 'https://3000-abcdefghij.byatlas.dev/'
const SESSION = 'wake_tracking_session'
const events: { event: string; properties: Record<string, unknown>; beacon: boolean }[] = []
let root: Root
let container: HTMLDivElement

function Probe(props: { wait: EPreviewWait }) {
  const start = usePreviewWakeTracking({
    sessionId: SESSION,
    power: EPodPowerPhase.Asleep,
    wait: props.wait,
  })
  return createElement(
    'button',
    {
      type: 'button',
      onClick: () => {
        start(URL)
        openBrowserUrl({ sessionId: SESSION, url: URL, ports: [] })
      },
    },
    'Open',
  )
}

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await unregisterDom()
})
beforeEach(() => {
  resetAnalyticsForTests()
  initAnalytics({
    enabled: true,
    client: {
      capture: (event, properties, options) => {
        events.push({ event, properties, beacon: options?.transport === 'sendBeacon' })
      },
      identify: () => {},
      reset: () => {},
      captureException: () => {},
    },
  })
  events.length = 0
  window.localStorage.clear()
  resetPreviewBrowsers()
  resetFrameRegistry()
  Reflect.deleteProperty(window, 'atlasDesktop')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  resetAnalyticsForTests()
  Reflect.deleteProperty(window, 'atlasDesktop')
})

async function open(wait = EPreviewWait.Asleep) {
  await act(async () => root.render(createElement(Probe, { wait })))
  await act(async () => container.querySelector('button')?.click())
  await act(async () =>
    changeRegistry((registry) =>
      shown({
        registry,
        slot: {
          threadId: SESSION,
          tabId: 'tab-1',
          element: container,
        },
      }),
    ),
  )
}
const report = (startingPage: boolean) =>
  reportPreviewDocument({
    sessionId: SESSION,
    tabId: 'tab-1',
    url: URL,
    startingPage,
    loaded: true,
  })

describe('preview wake tracking lifecycle', () => {
  it('emits once after a starting page becomes real loaded content', async () => {
    await open()
    act(() => report(true))
    expect(events).toEqual([])
    act(() => report(false))
    act(() => report(false))
    act(() => window.dispatchEvent(new Event('beforeunload')))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      event: 'preview_wake_open',
      beacon: false,
      properties: {
        session_id: SESSION,
        preview_hostname: '3000-abcdefghij.byatlas.dev',
        outcome: 'visible',
        starting_page_seen: true,
        wake_requested: true,
      },
    })
    expect(events[0]?.properties.click_to_visible_ms).toBeGreaterThanOrEqual(0)
  })

  it('waits to call an already-loaded document visible until its tab is shown', async () => {
    await open()
    await act(async () =>
      changeRegistry((registry) =>
        shown({
          registry,
          slot: {
            threadId: SESSION,
            tabId: 'tab-other',
            element: container,
          },
        }),
      ),
    )
    act(() => report(false))
    expect(events).toEqual([])
    await act(async () =>
      changeRegistry((registry) =>
        shown({
          registry,
          slot: {
            threadId: SESSION,
            tabId: 'tab-1',
            element: container,
          },
        }),
      ),
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.properties.outcome).toBe('visible')
  })

  it('finishes each click once when a second click replaces a waiting attempt', async () => {
    await open()
    await act(async () => container.querySelector('button')?.click())
    expect(events).toHaveLength(1)
    expect(events[0]?.properties.outcome).toBe('abandoned')
    act(() => report(false))
    expect(events).toHaveLength(2)
    expect(events[1]?.properties.outcome).toBe('visible')
  })

  it('does not guess visibility for a native browser without document reports', async () => {
    Reflect.set(window, 'atlasDesktop', { nativeBrowser: true })
    await open()
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(events).toEqual([])
  })

  it('does not emit for an awake pod open', async () => {
    await open(EPreviewWait.Awake)
    act(() => report(false))
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(events).toEqual([])
  })

  it('records starting without requesting another wake', async () => {
    await open(EPreviewWait.Waking)
    act(() => report(false))
    expect(events[0]?.properties.wake_requested).toBe(false)
  })

  it.each(['tab', 'pane', 'unmount', 'unload'])(
    'abandons once when the %s closes',
    async (kind) => {
      await open()
      act(() => report(true))
      await act(async () => {
        if (kind === 'tab')
          updatePreviewBrowser({
            threadId: SESSION,
            change: ({ state }) => closeTab({ state, id: 'tab-1' }),
          })
        if (kind === 'pane') changeRegistry((registry) => hidden({ registry, element: container }))
        if (kind === 'unmount') root.render(null)
        if (kind === 'unload') window.dispatchEvent(new Event('pagehide'))
      })
      act(() => window.dispatchEvent(new Event('pagehide')))
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        beacon: true,
        properties: { outcome: 'abandoned', starting_page_seen: true },
      })
      expect(events[0]?.properties.elapsed_ms).toBeGreaterThanOrEqual(0)
    },
  )
})
