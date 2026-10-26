import { describe, expect, test } from 'bun:test'

import { parseControls, type Control } from '../use-prototype'

const CONTROLS = {
  state: { type: 'select', label: 'State', options: ['idle', 'busy', 'error'], default: 'idle' },
  open: { type: 'boolean', label: 'Open', default: false },
  queued: { type: 'range', label: 'Queued', min: 0, max: 5, step: 1, default: 2 },
} satisfies Record<string, Control>

function parse(query: string) {
  return parseControls({ controls: CONTROLS, params: new URLSearchParams(query) })
}

describe('parseControls', () => {
  test('returns defaults when the query is empty', () => {
    expect(parse('')).toEqual({ state: 'idle', open: false, queued: 2 })
  })

  test('reads valid values', () => {
    expect(parse('state=busy&open=true&queued=4')).toEqual({
      state: 'busy',
      open: true,
      queued: 4,
    })
  })

  test('falls back to the default for an unknown select option', () => {
    expect(parse('state=nope').state).toBe('idle')
  })

  test('accepts 1 and 0 as booleans and rejects anything else', () => {
    expect(parse('open=1').open).toBe(true)
    expect(parse('open=0').open).toBe(false)
    expect(parse('open=yes').open).toBe(false)
  })

  test('clamps ranges and rejects non-numbers', () => {
    expect(parse('queued=99').queued).toBe(5)
    expect(parse('queued=-3').queued).toBe(0)
    expect(parse('queued=abc').queued).toBe(2)
    expect(parse('queued=').queued).toBe(2)
  })

  test('ignores params that are not declared controls', () => {
    expect(Object.keys(parse('other=1&state=error'))).toEqual(['state', 'open', 'queued'])
  })
})
