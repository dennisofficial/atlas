import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { ERightTab } from '../right-tab'
import { type RightPanelState, useRightPanel } from '../use-right-panel'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

async function mount() {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let latest: RightPanelState | null = null
  function Probe() {
    latest = useRightPanel()
    return null
  }
  await act(async () => root.render(<Probe />))
  return () => {
    if (latest === null) throw new Error('the probe never rendered')
    return latest
  }
}

describe('useRightPanel', () => {
  it('starts on Details with the sheet closed', async () => {
    const state = await mount()
    expect(state().tab).toBe(ERightTab.Details)
    expect(state().sheetOpen).toBe(false)
  })

  it('openChanges switches to Changes, remembers the path and opens the sheet', async () => {
    const state = await mount()
    await act(async () => state().openChanges('src/a.ts'))
    expect(state().tab).toBe(ERightTab.Changes)
    expect(state().changesPath).toBe('src/a.ts')
    expect(state().sheetOpen).toBe(true)
  })

  it('openAgent selects the agent, switches to Details and opens the sheet', async () => {
    const state = await mount()
    await act(async () => state().openChanges('a.ts'))
    await act(async () => state().openAgent('agent-1'))
    expect(state().tab).toBe(ERightTab.Details)
    expect(state().agentId).toBe('agent-1')
    expect(state().sheetOpen).toBe(true)
  })

  it('openDetails selects Details and opens the sheet', async () => {
    const state = await mount()
    await act(async () => state().setTab(ERightTab.Files))
    await act(async () => state().openDetails())
    expect(state().tab).toBe(ERightTab.Details)
    expect(state().sheetOpen).toBe(true)
  })

  it('clearAgent returns to the agent list', async () => {
    const state = await mount()
    await act(async () => state().openAgent('agent-1'))
    await act(async () => state().clearAgent())
    expect(state().agentId).toBeUndefined()
  })

  it('openContextFile remembers the path and closes the sheet', async () => {
    const state = await mount()
    await act(async () => state().openDetails())
    await act(async () => state().openContextFile('plans/a.md'))
    expect(state().contextPath).toBe('plans/a.md')
    expect(state().sheetOpen).toBe(false)
  })

  it('toggleContextFile closes when the path is already open', async () => {
    const state = await mount()
    await act(async () => state().toggleContextFile('a.md'))
    expect(state().contextPath).toBe('a.md')
    await act(async () => state().toggleContextFile('a.md'))
    expect(state().contextPath).toBeUndefined()
  })

  it('toggleContextFile switches to a different path and closes the sheet', async () => {
    const state = await mount()
    await act(async () => state().openDetails())
    await act(async () => state().toggleContextFile('a.md'))
    await act(async () => state().toggleContextFile('b.md'))
    expect(state().contextPath).toBe('b.md')
    expect(state().sheetOpen).toBe(false)
  })

  it('closeContextFile returns to the transcript', async () => {
    const state = await mount()
    await act(async () => state().openContextFile('a.md'))
    await act(async () => state().closeContextFile())
    expect(state().contextPath).toBeUndefined()
  })
  it('openFile shows the file, clears the context file and closes the sheet', async () => {
    const state = await mount()
    await act(async () => state().openContextFile('a.md'))
    await act(async () => state().openFile('src/a.ts'))
    expect(state().filePath).toBe('src/a.ts')
    expect(state().contextPath).toBeUndefined()
    expect(state().sheetOpen).toBe(false)
    await act(async () => state().closeFile())
    expect(state().filePath).toBeUndefined()
  })

  it('openChanges leaves the file view', async () => {
    const state = await mount()
    await act(async () => state().openFile('src/a.ts'))
    await act(async () => state().openChanges('src/a.ts'))
    expect(state().filePath).toBeUndefined()
    expect(state().tab).toBe(ERightTab.Changes)
  })
})
