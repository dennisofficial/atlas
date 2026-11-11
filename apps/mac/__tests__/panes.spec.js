import { describe, expect, test } from 'bun:test'

import { createPaneRegistry, PANE_TARGET_LIMIT, validCommand } from '../panes.js'

const fakeView = (id) => {
  const state = {
    id,
    url: '',
    loads: [],
    bounds: undefined,
    visible: false,
    history: [],
    handlers: {},
  }
  const view = {
    webContents: {
      on: (name, handler) => {
        state.handlers[name] = handler
      },
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

const registryWith = (limit, extra = {}) => {
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
    ...extra,
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

  test('shows a target again without reloading it when the address it was asked for is the same', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'hide', id: 'a' })
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: OTHER_RECT })
    expect(at('a').loads).toEqual([URL_A])
    expect(at('a').bounds).toEqual(OTHER_RECT)
  })

  test('navigates a target that is shown with an address it was never asked for', () => {
    const { registry, at } = registryWith()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'a', url: 'https://example.com/b', rect: RECT })
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

  test('keeps every tab of a session alive until the cap is reached', () => {
    const { registry, at, released } = registryWith()
    for (const id of ['t1', 't2', 't3'])
      registry.apply({ kind: 'show', id, url: URL_A, rect: RECT })
    registry.apply({ kind: 'hide', id: 't3' })
    registry.apply({ kind: 'show', id: 't1', url: URL_A, rect: RECT })
    expect(released).toEqual([])
    expect(registry.ids()).toEqual(['t1', 't2', 't3'])
    expect(at('t2').loads).toEqual([URL_A])
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

describe('createPaneRegistry reports', () => {
  const TARGET = 'pane:thread-1:tab-1'

  const reporters = () => {
    const navigations = []
    const titles = []
    const { registry, at } = registryWith(undefined, {
      onNavigate: (report) => navigations.push(report),
      onTitle: (report) => titles.push(report),
    })
    return { registry, at, navigations, titles }
  }

  test('reports every navigation of a target under its own id', () => {
    const { registry, at, navigations } = reporters()
    registry.apply({ kind: 'show', id: TARGET, url: URL_A, rect: RECT })
    at(TARGET).handlers['did-navigate']({}, 'https://example.com/b')
    at(TARGET).handlers['did-navigate-in-page']({}, 'https://example.com/b#top', true)
    expect(navigations).toEqual([
      { id: TARGET, url: 'https://example.com/b' },
      { id: TARGET, url: 'https://example.com/b#top' },
    ])
  })

  test('reports the page a target still shows when a load fails', () => {
    const { registry, at, navigations } = reporters()
    registry.apply({ kind: 'show', id: TARGET, url: URL_A, rect: RECT })
    navigations.length = 0
    at(TARGET).handlers['did-fail-load'](
      {},
      -105,
      'ERR_NAME_NOT_RESOLVED',
      'https://gone.example/',
      true,
    )
    expect(navigations).toEqual([{ id: TARGET, url: URL_A }])
  })

  test('ignores a failed sub frame and an aborted load', () => {
    const { registry, at, navigations } = reporters()
    registry.apply({ kind: 'show', id: TARGET, url: URL_A, rect: RECT })
    at(TARGET).handlers['did-fail-load']({}, -3, 'ERR_ABORTED', 'https://example.com/x', true)
    at(TARGET).handlers['did-fail-load']({}, -105, 'ERR', 'https://example.com/x', false)
    expect(navigations).toEqual([])
  })

  test('ignores a navigation inside a sub frame', () => {
    const { registry, at, navigations } = reporters()
    registry.apply({ kind: 'show', id: TARGET, url: URL_A, rect: RECT })
    at(TARGET).handlers['did-navigate-in-page']({}, 'https://ads.example.com/frame', false)
    expect(navigations).toEqual([])
  })

  test('reports the page title the target commits', () => {
    const { registry, at, titles } = reporters()
    registry.apply({ kind: 'show', id: TARGET, url: URL_A, rect: RECT })
    at(TARGET).handlers['page-title-updated']({}, 'Inbox')
    expect(titles).toEqual([{ id: TARGET, title: 'Inbox' }])
  })

  test('attributes each report to the target that made it', () => {
    const { registry, at, navigations } = reporters()
    registry.apply({ kind: 'show', id: 'a', url: URL_A, rect: RECT })
    registry.apply({ kind: 'show', id: 'b', url: URL_A, rect: RECT })
    at('b').handlers['did-navigate']({}, 'https://example.com/b')
    expect(navigations).toEqual([{ id: 'b', url: 'https://example.com/b' }])
  })
})
