import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { mountWith } from './transcript-mount'
import { installVirtuaViewport } from './virtua-viewport'

let restoreViewport = () => {}

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  restoreViewport = installVirtuaViewport()
})

afterAll(async () => {
  restoreViewport()
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const waitLine = (): string | null =>
  document.body.querySelector('[data-chat-item-id="background-wait"]')?.textContent ?? null

describe('what a settled session left running', () => {
  it('counts the agents and shells a turn left running', async () => {
    await mountWith({ rewind: null, background: { subagents: 2, shells: 1 } })

    expect(waitLine()).toContain('Waiting for 2 background agents and 1 shell to finish')
  })

  it('says nothing when the turn is still working', async () => {
    await mountWith({ rewind: null, working: true, background: { subagents: 1, shells: 0 } })

    expect(waitLine()).toBeNull()
  })

  it('says nothing when nothing is left running', async () => {
    await mountWith({ rewind: null, background: { subagents: 0, shells: 0 } })

    expect(waitLine()).toBeNull()
  })
})
