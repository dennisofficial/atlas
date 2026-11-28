import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import { RIGHT_PANEL_COLLAPSED_KEY } from '@/features/threads/panel/right-panel-collapsed'

import { SESSION_PANE_KEY } from '../pane-memory'
import { EPaneOpen } from '../pane-open'
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

  it('starts collapsed and keeps an expansion across a remount', async () => {
    resetCollapsed()
    const first = await mount('collapsed')
    expect(first().collapsed).toBe(true)
    await act(async () => first().toggleCollapsed())
    expect(first().collapsed).toBe(false)
    await first.unmount()
    const again = await mount('collapsed')
    expect(again().collapsed).toBe(false)
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

  it('opens the details card by default and remembers a close per session', async () => {
    resetCollapsed()
    const first = await mount('card')
    expect(first().detailsOpen).toBe(true)
    await act(async () => first().toggleDetails())
    expect(first().detailsOpen).toBe(false)
    await first.unmount()
    const stored = JSON.parse(window.localStorage.getItem(SESSION_PANE_KEY) ?? '{}')
    expect(stored.card.detailsOpen).toBe(false)
    const again = await mount('card')
    expect(again().detailsOpen).toBe(false)
    const other = await mount('card-other')
    expect(other().detailsOpen).toBe(true)
  })

  it('openDetails opens the card and asks the sheet for the Details tab', async () => {
    const state = await mount()
    await act(async () => state().setDetailsOpen(false))
    await act(async () => state().openDetails())
    expect(state().detailsOpen).toBe(true)
    expect(state().tab).toBe(ESessionPaneTab.Details)
    expect(state().sheetOpen).toBe(true)
  })

  it('shows the card and the tools panel one at a time', async () => {
    resetCollapsed()
    const state = await mount()
    expect(state().detailsShown).toBe(true)
    await act(async () => state().setCollapsed(false))
    expect(state().detailsOpen).toBe(true)
    expect(state().detailsShown).toBe(false)
    await act(async () => state().toggleDetails())
    expect(state().collapsed).toBe(true)
    expect(state().detailsShown).toBe(true)
    await act(async () => state().toggleDetails())
    expect(state().detailsShown).toBe(false)
    expect(state().detailsOpen).toBe(false)
  })

  it('hands the pod section a size request it consumes once', async () => {
    const state = await mount()
    expect(state().podSizeRequest).toBe(0)
    await act(async () => state().requestPodSize())
    await act(async () => state().requestPodSize())
    expect(state().podSizeRequest).toBe(2)
    await act(async () => state().consumePodSizeRequest())
    expect(state().podSizeRequest).toBe(0)
  })

  it('records an open request with a fresh id on the tab its kind names', async () => {
    const state = await mount()
    await act(async () => state().requestOpen({ kind: EPaneOpen.Changes, path: 'src/app.ts' }))
    expect(state().openRequest).toEqual({ kind: EPaneOpen.Changes, path: 'src/app.ts', id: 1 })
    expect(state().tab).toBe(ESessionPaneTab.Changes)
    expect(state().sheetOpen).toBe(true)

    await act(async () =>
      state().requestOpen({ kind: EPaneOpen.Context, path: '$ATLAS_CONTEXT_DIR/plan.md' }),
    )
    expect(state().openRequest).toEqual({
      kind: EPaneOpen.Context,
      path: '$ATLAS_CONTEXT_DIR/plan.md',
      id: 2,
    })
    expect(state().tab).toBe(ESessionPaneTab.Files)
  })

  it('clears only the open request it consumed', async () => {
    const state = await mount()
    await act(async () => state().requestOpen({ kind: EPaneOpen.File, path: 'src/app.ts' }))
    await act(async () => state().requestOpen({ kind: EPaneOpen.File, path: 'src/other.ts' }))
    await act(async () => state().consumeOpenRequest(1))
    expect(state().openRequest?.id).toBe(2)
    await act(async () => state().consumeOpenRequest(2))
    expect(state().openRequest).toBeUndefined()
  })
})
