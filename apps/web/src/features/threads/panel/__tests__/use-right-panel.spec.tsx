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
  it('starts on Agents with the sheet closed', async () => {
    const state = await mount()
    expect(state().tab).toBe(ERightTab.Agents)
    expect(state().sheetOpen).toBe(false)
  })

  it('openChanges switches to Changes, remembers the path and opens the sheet', async () => {
    const state = await mount()
    await act(async () => state().openChanges('src/a.ts'))
    expect(state().tab).toBe(ERightTab.Changes)
    expect(state().changesPath).toBe('src/a.ts')
    expect(state().sheetOpen).toBe(true)
  })
})
