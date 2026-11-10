import { describe, expect, test } from 'bun:test'

import { createPaneController } from '../pane-controller'
import { paneBounds } from '../pane-geometry'

const CONTENT = { width: 1280, height: 820 }
const rect = { x: 640, y: 0, width: 640, height: 820 }

function createFake() {
  const state = { urls: [], back: 0, forward: 0, reloads: 0, stops: 0 }
  const view = {
    bounds: null,
    visible: null,
    setBounds(next) {
      this.bounds = next
    },
    setVisible(next) {
      this.visible = next
    },
    webContents: {
      loadURL: (url) => {
        state.urls.push(url)
        return Promise.resolve()
      },
      reload: () => {
        state.reloads += 1
      },
      stop: () => {
        state.stops += 1
      },
      close: () => {
        state.closed = true
      },
      navigationHistory: {
        canGoBack: () => true,
        canGoForward: () => true,
        goBack: () => {
          state.back += 1
        },
        goForward: () => {
          state.forward += 1
        },
      },
    },
  }
  return { view, state }
}

function setup() {
  const fake = { attached: [], removed: [] }
  const { view, state } = createFake()
  const controller = createPaneController({
    contentView: {
      addChildView: () => fake.attached.push(true),
      removeChildView: () => fake.removed.push(true),
    },
    contentSize: CONTENT,
    createView: () => view,
  })
  return { controller, fake, view, state }
}

describe('pane geometry', () => {
  test('maps the contract rect straight onto content coordinates', () => {
    expect(paneBounds({ rect, contentSize: CONTENT })).toEqual(rect)
  })

  test('rounds to integer bounds', () => {
    expect(
      paneBounds({ rect: { x: 1.6, y: 2.4, width: 99.5, height: 10.2 }, contentSize: CONTENT }),
    ).toEqual({ x: 2, y: 2, width: 100, height: 10 })
  })

  test('clamps a rect that outgrows the content', () => {
    expect(
      paneBounds({
        rect: { x: 1200, y: 800, width: 900, height: 900 },
        contentSize: CONTENT,
      }),
    ).toEqual({ x: 1200, y: 800, width: 80, height: 20 })
  })
})

describe('pane controller', () => {
  test('creates the view lazily on show and loads the url', () => {
    const { controller, fake, view, state } = setup()
    expect(fake.attached).toEqual([])
    expect(controller.apply({ kind: 'show', url: 'https://x.test', rect })).toEqual({ ok: true })
    expect(fake.attached.length).toBe(1)
    expect(state.urls).toEqual(['https://x.test'])
    expect(view.bounds).toEqual(rect)
    expect(view.visible).toBe(true)
  })

  test('hides and re-shows the view without a new one', () => {
    const { controller, fake, view, state } = setup()
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    controller.apply({ kind: 'hide' })
    expect(view.visible).toBe(false)
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    expect(view.visible).toBe(true)
    expect(fake.attached.length).toBe(1)
    expect(state.urls).toEqual(['https://x.test'])
  })

  test('moves the view on setRect', () => {
    const { controller, view } = setup()
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    const narrow = { x: 320, y: 0, width: 960, height: 820 }
    controller.apply({ kind: 'setRect', rect: narrow })
    expect(view.bounds).toEqual(narrow)
  })

  test('re-clamps the rect when the window resizes', () => {
    const { controller, view } = setup()
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    controller.setContentSize({ width: 900, height: 600 })
    expect(view.bounds).toEqual({ x: 640, y: 0, width: 260, height: 600 })
  })

  test('leaves the view alone until a rect arrives', () => {
    const { controller, view } = setup()
    controller.setContentSize({ width: 1000, height: 700 })
    expect(view.bounds).toBeNull()
  })

  test('routes history verbs to the web contents', () => {
    const { controller, state } = setup()
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    for (const kind of ['back', 'forward', 'reload', 'stop'])
      expect(controller.apply({ kind })).toEqual({ ok: true })
    expect(state).toMatchObject({ back: 1, forward: 1, reloads: 1, stops: 1 })
  })

  test('obeys setObscured on top of visibility', () => {
    const { controller, view } = setup()
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    controller.apply({ kind: 'setObscured', obscured: true })
    expect(view.visible).toBe(false)
    controller.apply({ kind: 'setObscured', obscured: false })
    expect(view.visible).toBe(true)
  })

  test('navigate swaps the url in the existing view', () => {
    const { controller, state } = setup()
    expect(controller.apply({ kind: 'navigate', url: 'https://y.test' })).toEqual({
      ok: false,
      error: 'no pane to navigate',
    })
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    expect(controller.apply({ kind: 'navigate', url: 'https://y.test' })).toEqual({ ok: true })
    expect(state.urls).toEqual(['https://x.test', 'https://y.test'])
  })

  test('destroys the view and its web contents', () => {
    const { controller, fake, state } = setup()
    controller.apply({ kind: 'show', url: 'https://x.test', rect })
    controller.destroy()
    expect(fake.removed.length).toBe(1)
    expect(state.closed).toBe(true)
  })
})
