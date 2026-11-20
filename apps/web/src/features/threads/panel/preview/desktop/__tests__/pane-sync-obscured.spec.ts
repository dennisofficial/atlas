import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createPaneSync } from '../pane-sync'
import { fakeEnvironment, RECT, recorder, settle, slotAt, URL_A } from './pane-sync-harness'

describe('createPaneSync', () => {
  beforeAll(() => {
    registerDom()
  })

  afterAll(async () => {
    await unregisterDom()
  })

  it('tells the shell when something the app paints covers the pane', async () => {
    const { element } = slotAt(RECT)
    const dialog = document.createElement('div')
    const topAt = (): Element | null => dialog
    const { sent, send } = recorder()
    const fake = fakeEnvironment(topAt)
    createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    await settle()
    expect(sent.at(-1)).toEqual({ kind: 'setObscured', obscured: true })
    fake.mutate()
    fake.paint()
    await settle()
    expect(sent.filter((command) => command.kind === 'setObscured')).toHaveLength(1)
  })

  it('uncovers the pane again when the overlay goes away', async () => {
    const { element } = slotAt(RECT)
    let overlay: Element | null = document.createElement('div')
    const { sent, send } = recorder()
    const fake = fakeEnvironment(() => overlay)
    createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    await settle()
    overlay = null
    fake.mutate()
    fake.paint()
    await settle()
    expect(sent.filter((command) => command.kind === 'setObscured')).toEqual([
      { kind: 'setObscured', obscured: true },
      { kind: 'setObscured', obscured: false },
    ])
  })
})
