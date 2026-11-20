import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { RIGHT_PANEL_COLLAPSED_KEY } from '@/features/threads/panel/right-panel-collapsed'

import { SESSION_PANE_KEY } from '../pane-memory'
import { type SessionPaneState, useSessionPane } from '../pane-state'
import { ESessionPaneTab } from '../pane-tab'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const roots = new Set<Root>()

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

function resetCollapsed() {
  window.localStorage.removeItem(RIGHT_PANEL_COLLAPSED_KEY)
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
}

let mounts = 0

async function mount(sessionId = `session-${++mounts}`) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  roots.add(root)
  let latest: SessionPaneState | null = null
  function Probe() {
    latest = useSessionPane(sessionId)
    return null
  }
  await act(async () => root.render(<Probe />))
  const state = () => {
    if (latest === null) throw new Error('the probe never rendered')
    return latest
  }
  state.unmount = () => {
    roots.delete(root)
    return act(async () => root.unmount())
  }
  return state
}

describe('useSessionPane', () => {
  it('starts on Details with the sheet closed', async () => {
    const state = await mount()
    expect(state().tab).toBe(ESessionPaneTab.Details)
    expect(state().sheetOpen).toBe(false)
  })

  it('remembers the tab under its own session id', async () => {
    const first = await mount('remembered')
    await act(async () => first().setTab(ESessionPaneTab.Files))
    await first.unmount()
    const stored = JSON.parse(window.localStorage.getItem(SESSION_PANE_KEY) ?? '{}')
    expect(stored.remembered).toEqual({ tab: ESessionPaneTab.Files })
    const again = await mount('remembered')
    expect(again().tab).toBe(ESessionPaneTab.Files)
  })

  it('keeps each session on its own tab', async () => {
    const a = await mount('pane-a')
    await act(async () => a().setTab(ESessionPaneTab.Browser))
    await a.unmount()
    const b = await mount('pane-b')
    expect(b().tab).toBe(ESessionPaneTab.Details)
  })

  it('openTab switches the tab, opens the sheet and expands a collapsed pane', async () => {
    resetCollapsed()
    const state = await mount()
    await act(async () => state().setCollapsed(true))
    await act(async () => state().openTab(ESessionPaneTab.Terminal))
    expect(state().tab).toBe(ESessionPaneTab.Terminal)
    expect(state().sheetOpen).toBe(true)
    expect(state().collapsed).toBe(false)
  })

  it('toggles the collapse and keeps it across a remount', async () => {
    resetCollapsed()
    const first = await mount('collapsed')
    expect(first().collapsed).toBe(false)
    await act(async () => first().toggleCollapsed())
    expect(first().collapsed).toBe(true)
    await first.unmount()
    const again = await mount('collapsed')
    expect(again().collapsed).toBe(true)
  })

  it('restores the pane layout per session', async () => {
    const first = await mount('sized')
    expect(first().layout).toBeUndefined()
    await act(async () => first().rememberLayout({ transcript: 70, 'right-panel': 30 }))
    expect(first().layout).toEqual({ transcript: 70, 'right-panel': 30 })
    await first.unmount()
    const again = await mount('sized')
    expect(again().layout).toEqual({ transcript: 70, 'right-panel': 30 })
    const other = await mount('sized-other')
    expect(other().layout).toBeUndefined()
  })
})
