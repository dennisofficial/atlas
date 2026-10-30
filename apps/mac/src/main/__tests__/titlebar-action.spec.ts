import { describe, expect, test } from 'bun:test'
import { ETitlebarAction, parseDoubleClickAction, runTitlebarAction } from '../titlebar-action'

function fakeWindow(maximized: boolean) {
  const calls: string[] = []
  return {
    calls,
    win: {
      isMaximized: () => maximized,
      maximize: () => void calls.push('maximize'),
      unmaximize: () => void calls.push('unmaximize'),
      minimize: () => void calls.push('minimize'),
    },
  }
}

describe('parseDoubleClickAction', () => {
  test.each([
    ['Maximize\n', ETitlebarAction.Zoom],
    ['Minimize\n', ETitlebarAction.Minimize],
    ['None\n', ETitlebarAction.None],
    ['Fill\n', ETitlebarAction.Zoom],
    ['', ETitlebarAction.Zoom],
    [null, ETitlebarAction.Zoom],
  ])('%j -> %s', (raw, expected) => {
    expect(parseDoubleClickAction(raw)).toBe(expected)
  })
})

describe('runTitlebarAction', () => {
  test('zoom maximizes then unmaximizes', () => {
    const idle = fakeWindow(false)
    runTitlebarAction({ win: idle.win, action: ETitlebarAction.Zoom })
    expect(idle.calls).toEqual(['maximize'])
    const zoomed = fakeWindow(true)
    runTitlebarAction({ win: zoomed.win, action: ETitlebarAction.Zoom })
    expect(zoomed.calls).toEqual(['unmaximize'])
  })

  test('minimize minimizes and none does nothing', () => {
    const a = fakeWindow(false)
    runTitlebarAction({ win: a.win, action: ETitlebarAction.Minimize })
    expect(a.calls).toEqual(['minimize'])
    const b = fakeWindow(false)
    runTitlebarAction({ win: b.win, action: ETitlebarAction.None })
    expect(b.calls).toEqual([])
  })
})
