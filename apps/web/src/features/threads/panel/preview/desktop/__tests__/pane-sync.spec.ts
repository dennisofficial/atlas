import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createPaneSync } from '../pane-sync'
import { fakeEnvironment, RECT, recorder, settle, slotAt, URL_A } from './pane-sync-harness'

describe('createPaneSync', () => {
  beforeAll(() => {
    GlobalRegistrator.register()
  })

  afterAll(async () => {
    await GlobalRegistrator.unregister()
  })

  it('shows the shell pane where the slot sits', () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    createPaneSync({ element, url: URL_A, send, environment })
    expect(sent).toEqual([
      { kind: 'show', url: URL_A, rect: { x: 512, y: 64, width: 704, height: 832 } },
    ])
  })

  it('says nothing while the slot is zero sized', () => {
    const { element } = slotAt({ left: 0, top: 0, width: 0, height: 0 })
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    createPaneSync({ element, url: URL_A, send, environment })
    expect(sent).toEqual([])
  })

  it('sends one setRect per frame, carrying the latest rect', async () => {
    const { element, place } = slotAt(RECT)
    const { sent, send } = recorder()
    const fake = fakeEnvironment()
    createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    place({ left: 512, top: 64, width: 600, height: 800 })
    fake.resize()
    place({ left: 512, top: 64, width: 500, height: 700 })
    fake.resize()
    expect(fake.frameCount()).toBe(1)
    fake.paint()
    await settle()
    expect(sent.at(-1)).toEqual({
      kind: 'setRect',
      rect: { x: 512, y: 64, width: 500, height: 700 },
    })
    expect(sent.filter((command) => command.kind === 'setRect')).toHaveLength(1)
  })

  it('stays quiet when the slot is remeasured onto the same rect', () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const fake = fakeEnvironment()
    createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    fake.resize()
    fake.paint()
    expect(fake.frameCount()).toBe(0)
    expect(sent).toHaveLength(1)
  })

  it('follows a scrolled panel by remeasuring on scroll', async () => {
    const { element, place } = slotAt(RECT)
    const fake = fakeEnvironment()
    const { sent, send } = recorder()
    createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    place({ left: 512, top: 4, width: 704, height: 832 })
    fake.emit('scroll')
    fake.paint()
    await settle()
    expect(sent.at(-1)).toEqual({
      kind: 'setRect',
      rect: { x: 512, y: 4, width: 704, height: 832 },
    })
  })

  it('hides the pane when the slot unmounts', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const sync = createPaneSync({ element, url: URL_A, send, environment })
    sync.stop()
    await settle()
    expect(sent.at(-1)).toEqual({ kind: 'hide' })
  })

  it('observes nothing once stopped', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const fake = fakeEnvironment()
    const sync = createPaneSync({ element, url: URL_A, send, environment: fake.environment })
    const before = sent.length
    sync.stop()
    fake.resize()
    fake.mutate()
    fake.paint()
    await settle()
    expect(sent.slice(before)).toEqual([{ kind: 'hide' }])
    expect(fake.watcherCount()).toBe(0)
  })
})
