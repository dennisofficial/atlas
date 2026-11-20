import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import { EMPTY_DETAILS } from '../panel/details/details-input'
import { PANE_LAYOUTS_KEY } from '../panel/pane-layout-memory'
import type { PaneLayout } from '../panel/pane-layout-memory'
import { ERightTab } from '../panel/right-tab'
import { ThreadPanelProvider, type ThreadPanelValue } from '../panel/thread-panel-context'
import { type RightPanelState, useRightPanel } from '../panel/use-right-panel'
import { ThreadSplit } from '../thread-split'

const panel: ThreadPanelValue = {
  threadId: 'thr_split',
  channel: null,
  loaded: true,
  error: null,
  pod: null,
  working: false,
  changesPath: undefined,
  agentId: undefined,
  openChanges: () => undefined,
  openAgent: () => undefined,
  openDetails: () => undefined,
  details: EMPTY_DETAILS,
  clearAgent: () => undefined,
  contextPath: undefined,
  filePath: undefined,
  openContextFile: () => undefined,
  toggleContextFile: () => undefined,
  closeContextFile: () => undefined,
  openFile: () => undefined,
  closeFile: () => undefined,
  closePanel: () => undefined,
  refreshPod: () => undefined,
}

const router = { push: () => undefined } as unknown as AppRouterInstance

type ObserverCallback = (entries: Array<{ target: Element; borderBoxSize: unknown[] }>) => void

const observers: ObserverCallback[] = []
const roots = new Set<Root>()
const widths = new Map<Element, number>()

class FakeResizeObserver {
  constructor(callback: ObserverCallback) {
    observers.push(callback)
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function sizeElements(host: HTMLElement, sizes: number[]) {
  const panels = [...host.querySelectorAll('[data-slot="resizable-panel"]')]
  panels.forEach((panel, index) => {
    widths.set(panel, sizes[index] ?? 0)
    Object.defineProperty(panel, 'offsetWidth', {
      configurable: true,
      get: () => widths.get(panel) ?? 0,
    })
  })
  return { group: host.querySelector('[data-slot="resizable-panel-group"]'), panels }
}

const flush = () => act(async () => new Promise<void>((done) => setTimeout(done, 20)))

async function mountSplit(args: { layout: PaneLayout | undefined }) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.add(root)
  const commits: PaneLayout[] = []
  const flags: boolean[] = []
  const view = (collapsed: boolean) => (
    <AppRouterContext.Provider value={router}>
      <ThreadPanelProvider value={panel}>
        <ThreadSplit
          tab={ERightTab.Details}
          onTabChange={() => undefined}
          layout={args.layout}
          onLayoutChange={(layout) => commits.push(layout)}
          collapsed={collapsed}
          onCollapsedChange={(next) => flags.push(next)}
        >
          <p>transcript</p>
        </ThreadSplit>
      </ThreadPanelProvider>
    </AppRouterContext.Provider>
  )
  await act(async () => root.render(view(false)))
  await flush()
  return {
    host,
    commits,
    flags,
    show: async (collapsed: boolean) => {
      await act(async () => root.render(view(collapsed)))
      await flush()
    },
  }
}

async function measure(host: HTMLElement, sizes: number[]): Promise<Element[]> {
  const { group, panels } = sizeElements(host, sizes)
  if (group === null) return panels
  await act(async () => {
    for (const observer of observers) {
      observer([{ target: group, borderBoxSize: [{ inlineSize: 1000, blockSize: 800 }] }])
    }
  })
  await flush()
  return panels
}

async function mountWithHook() {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.add(root)
  let latest: RightPanelState | null = null
  let visible = true
  function Harness() {
    const rightPanel = useRightPanel('thr_responsive')
    latest = rightPanel
    if (!visible) return <p>mobile sheet</p>
    return (
      <AppRouterContext.Provider value={router}>
        <ThreadPanelProvider value={panel}>
          <ThreadSplit
            tab={ERightTab.Details}
            onTabChange={() => undefined}
            layout={rightPanel.layout}
            onLayoutChange={rightPanel.rememberLayout}
            collapsed={rightPanel.collapsed}
            onCollapsedChange={rightPanel.setCollapsed}
          >
            <p>transcript</p>
          </ThreadSplit>
        </ThreadPanelProvider>
      </AppRouterContext.Provider>
    )
  }
  const render = async () => {
    await act(async () => root.render(<Harness />))
    await flush()
  }
  await render()
  const state = () => {
    if (latest === null) throw new Error('the harness never rendered')
    return latest
  }
  const show = async (next: boolean) => {
    visible = next
    await render()
  }
  return { host, state, show, unmount: () => act(async () => root.unmount()) }
}

const storedLayout = () =>
  JSON.parse(window.localStorage.getItem(PANE_LAYOUTS_KEY) ?? '{}').thr_responsive

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
  observers.length = 0
  widths.clear()
  window.localStorage.clear()
  document.body.innerHTML = ''
})

describe('ThreadSplit', () => {
  it('applies a collapse that arrived while the group was deferred', async () => {
    const split = await mountSplit({ layout: { transcript: 60, 'right-panel': 40 } })
    await split.show(true)

    const panels = await measure(split.host, [1000, 0])
    expect(panels).toHaveLength(2)

    expect(split.flags).not.toContain(true)
    expect(panels[1]?.getAttribute('style')).toBeDefined()
    expect(panels[1]?.getAttribute('style')).toContain('flex-grow: 0')
  })

  it('remounts the split from the latest width after a desktop to mobile switch', async () => {
    window.localStorage.setItem(
      PANE_LAYOUTS_KEY,
      JSON.stringify({ thr_responsive: { transcript: 60, 'right-panel': 40 } }),
    )
    const app = await mountWithHook()
    await measure(app.host, [1000, 0])

    await act(async () => app.state().rememberLayout({ transcript: 40, 'right-panel': 60 }))
    await app.show(false)
    await app.show(true)

    const panels = await measure(app.host, [1000, 0])
    expect(panels[0]?.getAttribute('style')).toContain('flex-grow: 40')
    expect(app.state().layout).toEqual({ transcript: 40, 'right-panel': 60 })
    expect(storedLayout()).toEqual({ transcript: 40, 'right-panel': 60 })
  })
})
