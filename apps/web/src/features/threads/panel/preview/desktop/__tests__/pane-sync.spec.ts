import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { SlotEnvironment } from '../../placement'
import type { PaneCommand } from '../pane-command'
import type { SamplePoint } from '../pane-geometry'
import { notePaneLocation } from '../pane-locations'
import { createPaneSync, type PaneEnvironment, type PaneSender } from '../pane-sync'

type Rect = { left: number; top: number; width: number; height: number }

const slotAt = (rect: Rect) => {
  const state = { rect }
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({
    ...state.rect,
    x: state.rect.left,
    y: state.rect.top,
    right: state.rect.left + state.rect.width,
    bottom: state.rect.top + state.rect.height,
    toJSON: () => ({}),
  })
  const place = (next: Rect) => {
    state.rect = next
  }
  return { element, place }
}

const fakeEnvironment = (topAt: (point: SamplePoint) => Element | null = () => null) => {
  const resizers: Array<() => void> = []
  const listeners = new Map<string, Array<() => void>>()
  const documents: Array<() => void> = []
  const frames = new Map<number, () => void>()
  let handles = 0
  const base: SlotEnvironment = {
    observeResize: ({ onResize }) => {
      resizers.push(onResize)
      return () => resizers.splice(resizers.indexOf(onResize), 1)
    },
    listen: ({ type, onEvent }) => {
      listeners.set(type, [...(listeners.get(type) ?? []), onEvent])
      return () =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((held) => held !== onEvent),
        )
    },
  }
  const environment: PaneEnvironment = {
    ...base,
    requestFrame: (run) => {
      handles += 1
      frames.set(handles, run)
      return handles
    },
    cancelFrame: (handle) => {
      frames.delete(handle)
    },
    topAt,
    observeDocument: (onChange) => {
      documents.push(onChange)
      return () => documents.splice(documents.indexOf(onChange), 1)
    },
  }
  return {
    environment,
    resize: () => {
      for (const resizer of [...resizers]) resizer()
    },
    emit: (type: string) => {
      for (const onEvent of [...(listeners.get(type) ?? [])]) onEvent()
    },
    paint: () => {
      const runs = [...frames.entries()]
      frames.clear()
      for (const [, run] of runs) run()
    },
    mutate: () => {
      for (const onChange of [...documents]) onChange()
    },
    frameCount: () => frames.size,
    watcherCount: () => resizers.length + documents.length,
  }
}

const recorder = () => {
  const sent: PaneCommand[] = []
  const send: PaneSender = async (command) => {
    sent.push(command)
    return true
  }
  return { sent, send }
}

const deferred = () => {
  const sent: PaneCommand[] = []
  const releases: Array<() => void> = []
  const send: PaneSender = (command) => {
    sent.push(command)
    return new Promise<boolean>((resolve) => releases.push(() => resolve(true)))
  }
  const settle = async () => {
    while (releases.length > 0) {
      for (const release of releases.splice(0)) release()
      await new Promise<void>((done) => setTimeout(done, 0))
    }
  }
  return { sent, send, settle }
}

const settle = () => new Promise<void>((done) => setTimeout(done, 0))

const URL_A = 'https://example.com/a'
const RECT: Rect = { left: 512, top: 64, width: 704, height: 832 }

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

  it('navigates the shown pane when the tab url changes', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const sync = createPaneSync({ element, url: URL_A, send, environment })
    sync.apply('https://example.com/b')
    sync.apply('https://example.com/b')
    await settle()
    expect(sent.slice(1)).toEqual([{ kind: 'navigate', url: 'https://example.com/b' }])
  })

  it('leaves the pane alone when the tab follows the address the pane reported', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const id = 'pane:reported:tab-1'
    const reported = 'https://example.com/reported'
    notePaneLocation({ id, url: reported })
    const sync = createPaneSync({ element, url: URL_A, send, environment, id })
    sync.apply(reported)
    await settle()
    expect(sent.slice(1)).toEqual([])
  })

  it('navigates back to an address the pane reported before, once it has moved on', async () => {
    const { element } = slotAt(RECT)
    const { sent, send } = recorder()
    const { environment } = fakeEnvironment()
    const id = 'pane:reported-then-elsewhere:tab-1'
    notePaneLocation({ id, url: URL_A })
    const sync = createPaneSync({ element, url: URL_A, send, environment, id })
    sync.apply('https://example.com/b')
    await settle()
    sync.apply(URL_A)
    await settle()
    expect(sent.slice(1)).toEqual([
      { kind: 'navigate', url: 'https://example.com/b' },
      { kind: 'navigate', url: URL_A },
    ])
  })

  it('shows a remounted target without navigating when its url is unchanged', async () => {
    const first = slotAt(RECT)
    const firstRun = recorder()
    const firstSync = createPaneSync({
      element: first.element,
      id: 'pane:remount:unchanged',
      url: URL_A,
      send: firstRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    firstSync.stop()
    const second = slotAt(RECT)
    const secondRun = recorder()
    createPaneSync({
      element: second.element,
      id: 'pane:remount:unchanged',
      url: URL_A,
      send: secondRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    expect(secondRun.sent.filter((command) => command.kind === 'navigate')).toEqual([])
    expect(secondRun.sent[0]).toMatchObject({ kind: 'show', url: URL_A })
  })

  it('navigates a remounted target whose url changed while it was away', async () => {
    const first = slotAt(RECT)
    const firstRun = recorder()
    const firstSync = createPaneSync({
      element: first.element,
      id: 'pane:remount:changed',
      url: URL_A,
      send: firstRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    firstSync.stop()
    const second = slotAt(RECT)
    const secondRun = recorder()
    createPaneSync({
      element: second.element,
      id: 'pane:remount:changed',
      url: 'https://example.com/moved',
      send: secondRun.send,
      environment: fakeEnvironment().environment,
    })
    await settle()
    expect(secondRun.sent.filter((command) => command.kind === 'navigate')).toEqual([
      { kind: 'navigate', url: 'https://example.com/moved' },
    ])
  })

  it('keeps one command in flight and sends the latest after it settles', async () => {
    const { element, place } = slotAt(RECT)
    const { sent, send, settle } = deferred()
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
    await settle()
    expect(sent).toEqual([
      { kind: 'show', url: URL_A, rect: { x: 512, y: 64, width: 704, height: 832 } },
      { kind: 'setRect', rect: { x: 512, y: 64, width: 500, height: 700 } },
    ])
  })

  it('still hides after a command is left in flight', async () => {
    const { element } = slotAt(RECT)
    const { sent, send, settle } = deferred()
    const { environment } = fakeEnvironment()
    const sync = createPaneSync({ element, url: URL_A, send, environment })
    sync.stop()
    await settle()
    expect(sent.at(-1)).toEqual({ kind: 'hide' })
  })
})
