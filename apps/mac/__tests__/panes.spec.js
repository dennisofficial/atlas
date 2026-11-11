import { describe, expect, test } from 'bun:test'

import { createPaneRegistry, PANE_TARGET_LIMIT, validCommand } from '../panes.js'

const fakeView = (id) => {
  const state = { id, url: '', loads: [], bounds: undefined, visible: false, history: [] }
  const view = {
    webContents: {
      getURL: () => state.url,
      loadURL: (url) => {
        state.loads.push(url)
        state.url = url
        return Promise.resolve()
      },
      close: () => state.history.push('close'),
      navigationHistory: {
        goBack: () => state.history.push('back'),
        goForward: () => state.history.push('forward'),
      },
      reload: () => state.history.push('reload'),
      stop: () => state.history.push('stop'),
    },
    setVisible: (visible) => {
      state.visible = visible
    },
    setBounds: (rect) => {
      state.bounds = rect
    },
  }
  return { view, state }
}

const registryWith = (limit) => {
  const made = new Map()
  const released = []
  const registry = createPaneRegistry({
    create: (id) => {
      const one = fakeView(id)
      made.set(id, one)
      return one.view
    },
    release: (view) => {
      for (const [id, one] of made) if (one.view === view) released.push(id)
    },
    ...(limit === undefined ? {} : { limit }),
  })
  const at = (id) => made.get(id).state
  return { registry, released, at }
}

const RECT = { x: 512, y: 64, width: 704, height: 832 }
const OTHER_RECT = { x: 0, y: 0, width: 320, height: 200 }
const URL_A = 'https://example.com/a'

describe('validCommand', () => {
  test('accepts a command with no target so a released web build keeps working', () => {
    expect(validCommand({ kind: 'hide' })).toBe(true)
    expect(validCommand({ kind: 'show', url: URL_A, rect: RECT })).toBe(true)
  })

  test('accepts a target id of any string', () => {
    expect(validCommand({ kind: 'hide', id: 'pane:s1:t1' })).toBe(true)
  })

  test('rejects a target id that is not a string', () => {
    expect(validCommand({ kind: 'hide', id: 7 })).toBe(false)
    expect(validCommand({ kind: 'show', url: URL_A, rect: RECT, id: null })).toBe(false)
  })
})

describe('createPaneRegistry', () => {
  test('loads the url once when the same target is shown twice', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'hide', id: 'a' })
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    expect(at('a').loads).toEqual([URL_A])
    expect(registry.size()).toBe(1)
  })

  test('treats a command without an id as one default target', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', url: URL_A, rect: RECT })
    registry.apply({ kind: 'hide' })
    registry.apply({ kind: 'show', url: URL_A, rect: RECT })
    expect(at('default').loads).toEqual([URL_A])
    expect(registry.size()).toBe(1)
  })

  test('keeps the page when the target is shown again, and moves it only on navigate', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'a', url: 'https://example.com/b', rect: RECT })
    expect(at('a').loads).toEqual([URL_A])
    registry.apply({ kind: 'navigate', id: 'a', url: 'https://example.com/b' })
    expect(at('a').loads).toEqual([URL_A, 'https://example.com/b'])
  })

  test('hides the first target when a second one is shown, and reuses rather than reloads', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'b', url: 'https://example.com/b', rect: RECT })
    expect(at('a').visible).toBe(false)
    expect(at('b').visible).toBe(true)
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    expect(at('a').visible).toBe(true)
    expect(at('b').visible).toBe(false)
    expect(at('a').loads).toEqual([URL_A])
    expect(at('b').loads).toEqual(['https://example.com/b'])
  })

  test('hides only the target it names', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'setObscured', id: 'a', obscured: true })
    registry.apply({ kind: 'hide', id: 'a' })
    expect(at('a').visible).toBe(false)
    expect(at('a').loads).toEqual([URL_A])
  })

  test('setRect only touches its own target', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'b', url: 'https://example.com/b', rect: RECT })
    registry.apply({ kind: 'setRect', id: 'a', rect: OTHER_RECT })
    expect(at('a').bounds).toEqual(OTHER_RECT)
    expect(at('b').bounds).toEqual(RECT)
  })

  test('routes navigation to its own target', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'b', url: 'https://example.com/b', rect: RECT })
    registry.apply({ kind: 'back', id: 'a' })
    registry.apply({ kind: 'forward', id: 'a' })
    registry.apply({ kind: 'reload', id: 'a' })
    registry.apply({ kind: 'stop', id: 'a' })
    registry.apply({ kind: 'navigate', id: 'b', url: 'https://example.com/c' })
    expect(at('a').history).toEqual(['back', 'forward', 'reload', 'stop'])
    expect(at('b').loads).toEqual(['https://example.com/b', 'https://example.com/c'])
  })

  test('ignores a command for a target it never showed', () => {
    const { registry, released } = registryWith()
    registry.apply({ kind: 'hide', id: 'ghost' })
    registry.apply({ kind: 'setRect', id: 'ghost', rect: RECT })
    registry.apply({ kind: 'navigate', id: 'ghost', url: URL_A })
    expect(registry.size()).toBe(0)
    expect(released).toEqual([])
  })

  test('destroys the least recently shown target past the cap', () => {
    const { registry, at, released } = registryWith()
    const ids = Array.from({ length: PANE_TARGET_LIMIT }, (_, index) => `t${index}`)
    for (const id of ids) registry.apply({ kind: 'show', id, url: URL_A, rect: RECT })
    expect(registry.size()).toBe(PANE_TARGET_LIMIT)
    registry.apply({ kind: 'show', id: 't0', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'extra', url: URL_A, rect: RECT })
    expect(released).toEqual(['t1'])
    expect(at('t0').visible).toBe(false)
    expect(registry.size()).toBe(PANE_TARGET_LIMIT)
    expect(registry.ids()).not.toContain('t1')
  })

  test('destroys every target it holds', () => {
    const { registry, released } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'b', url: URL_A, rect: RECT })
    registry.destroy()
    expect(released).toEqual(['a', 'b'])
    expect(registry.size()).toBe(0)
  })
})
