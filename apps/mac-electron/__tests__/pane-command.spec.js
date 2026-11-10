import { describe, expect, test } from 'bun:test'

import { parsePaneCommand } from '../pane-command'

const rect = { x: 640, y: 0, width: 640, height: 820 }

describe('pane command', () => {
  test('accepts every kind the desktop host sends', () => {
    expect(parsePaneCommand({ kind: 'show', url: 'https://x.test', rect })).toEqual({
      kind: 'show',
      url: 'https://x.test',
      rect,
    })
    expect(parsePaneCommand({ kind: 'hide' })).toEqual({ kind: 'hide' })
    expect(parsePaneCommand({ kind: 'setRect', rect })).toEqual({ kind: 'setRect', rect })
    expect(parsePaneCommand({ kind: 'navigate', url: 'https://y.test' })).toEqual({
      kind: 'navigate',
      url: 'https://y.test',
    })
    for (const kind of ['back', 'forward', 'reload', 'stop'])
      expect(parsePaneCommand({ kind })).toEqual({ kind })
    expect(parsePaneCommand({ kind: 'setObscured', obscured: true })).toEqual({
      kind: 'setObscured',
      obscured: true,
    })
  })

  test('rejects an unknown kind', () => {
    expect(parsePaneCommand({ kind: 'explode' })).toBeNull()
  })

  test('rejects a show without a rect', () => {
    expect(parsePaneCommand({ kind: 'show', url: 'https://x.test' })).toBeNull()
  })

  test('rejects a negative rect', () => {
    expect(parsePaneCommand({ kind: 'setRect', rect: { ...rect, width: -1 } })).toBeNull()
  })

  test('rejects an empty url', () => {
    expect(parsePaneCommand({ kind: 'navigate', url: '' })).toBeNull()
  })

  test('rejects a non-boolean obscured', () => {
    expect(parsePaneCommand({ kind: 'setObscured', obscured: 'yes' })).toBeNull()
  })
})
