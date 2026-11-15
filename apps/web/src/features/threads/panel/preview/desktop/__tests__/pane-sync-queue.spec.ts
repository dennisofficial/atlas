import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createPaneSync } from '../pane-sync'
import {
  deferred,
  fakeEnvironment,
  orderedSender,
  RECT,
  settle,
  slotAt,
  URL_A,
} from './pane-sync-harness'

describe('createPaneSync', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  it('keeps one command in flight and sends the latest after it settles', async () => {
    const { element, place } = slotAt(RECT)
    const { sent, send, settle: settleSender } = deferred()
    const fake = fakeEnvironment()
    createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    place({ left: 512, top: 64, width: 600, height: 800 })
    fake.resize()
    fake.paint()
    place({ left: 512, top: 64, width: 500, height: 700 })
    fake.resize()
    fake.paint()
    expect(sent).toEqual([
      { kind: 'show', url: URL_A, rect: { x: 512, y: 64, width: 704, height: 832 } },
    ])
    await settleSender()
    expect(sent).toEqual([
      { kind: 'show', url: URL_A, rect: { x: 512, y: 64, width: 704, height: 832 } },
      { kind: 'setRect', rect: { x: 512, y: 64, width: 500, height: 700 } },
    ])
  })

  it('sends a stopped sync hide before its replacement shows', async () => {
    const { element } = slotAt(RECT)
    const { sent, send, releaseFirst } = orderedSender()
    const id = 'pane:collapse:tab-1'
    const sync = createPaneSync({
      element,
      url: URL_A,
      send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    sync.stop()

    const replacement = slotAt(RECT)
    createPaneSync({
      element: replacement.element,
      id,
      url: URL_A,
      send,
      environment: fakeEnvironment().environment,
    })
    releaseFirst()
    await settle()
    await settle()
    await settle()

    expect(sent.map((command) => command.kind)).toEqual(['show', 'hide', 'show'])
  })

  it('still hides after a command is left in flight', async () => {
    const { element } = slotAt(RECT)
    const { sent, send, settle: settleSender } = deferred()
    const { environment } = fakeEnvironment()
    const sync = createPaneSync({ element, url: URL_A, send, environment })
    sync.stop()
    await settleSender()
    expect(sent.at(-1)).toEqual({ kind: 'hide' })
  })
})
