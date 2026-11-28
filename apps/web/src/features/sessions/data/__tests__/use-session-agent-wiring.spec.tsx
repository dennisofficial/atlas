import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as realNavigation from 'next/navigation'
import { act, useState } from 'react'
import type { Root } from 'react-dom/client'

import { stubViewTransitions } from '../../panel/__tests__/view-transition-stub'
import type { SessionAgentWiring } from '../use-session-agent-wiring'

const pushed: string[] = []
const replaced: string[] = []
let query = ''

mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => pushed.push(href),
    replace: (href: string) => replaced.push(href),
  }),
  usePathname: () => '/sessions/ses-1',
  useSearchParams: () => new URLSearchParams(query),
}))

const { useSessionAgentWiring } = await import('../use-session-agent-wiring')

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  mock.module('next/navigation', () => realNavigation)
  await unregisterDom()
})

beforeEach(() => {
  pushed.length = 0
  replaced.length = 0
  query = ''
  window.localStorage.clear()
})

const roots = new Set<Root>()

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots.clear()
})

const mount = async (): Promise<{ read: () => SessionAgentWiring; nudge: () => Promise<void> }> => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.add(root)
  const holder = {} as { wiring: SessionAgentWiring; bump: () => void }
  function Probe() {
    const [, setTick] = useState(0)
    holder.bump = () => setTick((tick) => tick + 1)
    Object.assign(holder, { wiring: useSessionAgentWiring({ sessionId: 'ses-1', working: true }) })
    return null
  }
  await act(async () => root.render(<Probe />))
  return {
    read: () => holder.wiring,
    nudge: async () => {
      await act(async () => holder.bump())
    },
  }
}

describe('useSessionAgentWiring', () => {
  it('carries the agent in the url into the panel and opens the pane', async () => {
    query = 'agent=agent-1'
    const { read } = await mount()

    expect(read().panel.agentId).toBe('agent-1')
    expect(read().panel.working).toBe(true)
    expect(read().pane.sheetOpen).toBe(true)
  })

  it('leaves the pane closed without an agent in the url', async () => {
    const { read } = await mount()

    expect(read().panel.agentId).toBeUndefined()
    expect(read().pane.sheetOpen).toBe(false)
    expect(pushed).toEqual([])
    expect(replaced).toEqual([])
  })

  it('writes the agent into the url and clears it again', async () => {
    const { read } = await mount()

    await act(async () => read().openAgent('agent-2'))
    expect(pushed).toEqual(['/sessions/ses-1?agent=agent-2'])
    expect(read().pane.sheetOpen).toBe(true)

    await act(async () => read().panel.clearAgent())
    expect(replaced).toEqual(['/sessions/ses-1'])
  })

  it('closes the sheet when the agent leaves the url', async () => {
    query = 'agent=agent-1'
    const { read, nudge } = await mount()
    expect(read().pane.sheetOpen).toBe(true)

    query = ''
    await nudge()

    expect(read().pane.sheetOpen).toBe(false)
    expect(read().panel.agentId).toBeUndefined()
  })

  it('clears the agent when the sheet is dismissed', async () => {
    query = 'agent=agent-1'
    const { read } = await mount()

    await act(async () => read().sheetOpenChange(false))

    expect(read().pane.sheetOpen).toBe(false)
    expect(replaced).toEqual(['/sessions/ses-1'])
  })

  it('keeps the agent when the sheet is opened', async () => {
    query = 'agent=agent-1'
    const { read } = await mount()

    await act(async () => read().sheetOpenChange(true))

    expect(read().pane.sheetOpen).toBe(true)
    expect(replaced).toEqual([])
  })

  it('records the parent agent in the url when a sub-agent opens one of its own', async () => {
    query = 'agent=thr_child'
    const { read } = await mount()

    await act(async () => read().openAgent('thr_grandchild', 'thr_child'))

    expect(pushed).toEqual(['/sessions/ses-1?agent=thr_grandchild&parent=thr_child'])
  })

  it('carries the parent agent into the panel', async () => {
    query = 'agent=thr_grandchild&parent=thr_child'
    const { read } = await mount()

    expect(read().panel.agentId).toBe('thr_grandchild')
    expect(read().panel.agentParentId).toBe('thr_child')
  })

  it('returns to the parent agent when a nested agent is cleared', async () => {
    query = 'agent=thr_grandchild&parent=thr_child'
    const { read } = await mount()

    await act(async () => read().panel.clearAgent())

    expect(replaced).toEqual(['/sessions/ses-1?agent=thr_child'])
  })

  it('keeps the other query params beside the agent', async () => {
    query = 'tab=files'
    const { read } = await mount()

    await act(async () => read().openAgent('agent-2'))
    expect(pushed).toEqual(['/sessions/ses-1?tab=files&agent=agent-2'])
  })

  it('shows the agent inside the one morph that opens the pane', async () => {
    const { read } = await mount()
    const transitions = stubViewTransitions()
    try {
      await act(async () => read().openAgent('agent-2'))
      expect(read().panel.agentId).toBeUndefined()
      expect(read().pane.collapsed).toBe(true)

      await act(async () => transitions.runPending())

      expect(read().panel.agentId).toBe('agent-2')
      expect(read().pane.collapsed).toBe(false)
      expect(transitions.started()).toBe(1)
    } finally {
      transitions.restore()
    }
  })

  it('stays collapsed as the operator left it', async () => {
    const { read } = await mount()

    expect(read().pane.collapsed).toBe(true)
  })

  it('folds the pane back into the details card when Back leaves the agent', async () => {
    const { read } = await mount()
    expect(read().pane.detailsShown).toBe(true)

    await act(async () => read().openAgent('agent-2'))
    expect(read().pane.collapsed).toBe(false)

    await act(async () => read().panel.clearAgent())
    expect(read().pane.collapsed).toBe(true)
    expect(read().pane.detailsShown).toBe(true)
  })

  it('folds the pane back when browser history drops the agent', async () => {
    const { read, nudge } = await mount()
    await act(async () => read().openAgent('agent-2'))
    query = 'agent=agent-2'
    await nudge()
    expect(read().pane.collapsed).toBe(false)

    query = ''
    await nudge()
    expect(read().pane.collapsed).toBe(true)
  })

  it('reopens the agent a session had open when the operator comes back to it', async () => {
    const first = await mount()
    await act(async () => first.read().openAgent('thr_grandchild', 'thr_child'))
    for (const root of roots) await act(async () => root.unmount())
    roots.clear()
    pushed.length = 0

    const again = await mount()
    expect(again.read().panel.agentId).toBe('thr_grandchild')
    expect(again.read().panel.agentParentId).toBe('thr_child')
    expect(again.read().pane.collapsed).toBe(false)
    expect(replaced).toEqual(['/sessions/ses-1?agent=thr_grandchild&parent=thr_child'])
  })

  it('forgets the agent once the operator leaves it', async () => {
    const first = await mount()
    await act(async () => first.read().openAgent('agent-2'))
    await act(async () => first.read().panel.clearAgent())
    for (const root of roots) await act(async () => root.unmount())
    roots.clear()
    replaced.length = 0

    const again = await mount()
    expect(again.read().panel.agentId).toBeUndefined()
    expect(replaced).toEqual([])
  })
})
