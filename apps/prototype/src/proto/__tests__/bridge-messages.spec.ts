import { describe, expect, test } from 'bun:test'

import {
  applyControlMessage,
  EProtoMessage,
  ETheme,
  parseChromeMessage,
  parsePageMessage,
} from '../bridge-messages'
import type { Control } from '../use-prototype'

const CONTROLS: Record<string, Control> = {
  state: { type: 'select', label: 'State', options: ['a', 'b'], default: 'a' },
  open: { type: 'boolean', label: 'Open', default: false },
}

describe('parsePageMessage', () => {
  test('accepts a well-formed controls message', () => {
    const data = {
      kind: 'controls',
      path: '/x?state=b',
      controls: CONTROLS,
      values: { state: 'b', open: false },
    }
    expect(parsePageMessage(data)?.kind).toBe(EProtoMessage.Controls)
  })

  test('accepts a location message', () => {
    expect(parsePageMessage({ kind: 'location', path: '/y' })).toEqual({
      kind: EProtoMessage.Location,
      path: '/y',
    })
  })

  test('rejects malformed controls and unknown kinds', () => {
    expect(
      parsePageMessage({
        kind: 'controls',
        path: '/x',
        controls: { s: { type: 'nope' } },
        values: {},
      }),
    ).toBeNull()
    expect(
      parsePageMessage({ kind: 'controls', path: '/x', controls: CONTROLS, values: { a: {} } }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'other', path: '/x' })).toBeNull()
    expect(parsePageMessage('nope')).toBeNull()
  })
})

describe('parseChromeMessage', () => {
  test('accepts set, reset and theme', () => {
    expect(parseChromeMessage({ kind: 'set', key: 'state', value: 'b' })).toEqual({
      kind: EProtoMessage.Set,
      key: 'state',
      value: 'b',
    })
    expect(parseChromeMessage({ kind: 'reset' })).toEqual({ kind: EProtoMessage.Reset })
    expect(parseChromeMessage({ kind: 'theme', theme: 'light' })).toEqual({
      kind: EProtoMessage.Theme,
      theme: ETheme.Light,
    })
  })

  test('rejects bad payloads', () => {
    expect(parseChromeMessage({ kind: 'theme', theme: 'neon' })).toBeNull()
    expect(parseChromeMessage({ kind: 'set', key: 1, value: 'b' })).toBeNull()
    expect(parseChromeMessage({ kind: 'set', key: 'k', value: null })).toBeNull()
    expect(parseChromeMessage(null)).toBeNull()
  })
})

describe('applyControlMessage', () => {
  test('sets a known key and preserves other params', () => {
    const search = applyControlMessage({
      search: 'foo=1&state=a',
      controls: CONTROLS,
      message: { kind: EProtoMessage.Set, key: 'state', value: 'b' },
    })
    expect(search).toBe('foo=1&state=b')
  })

  test('ignores keys the page did not announce', () => {
    const search = applyControlMessage({
      search: '',
      controls: CONTROLS,
      message: { kind: EProtoMessage.Set, key: 'evil', value: 'x' },
    })
    expect(search).toBeNull()
  })

  test('reset removes only control keys', () => {
    const search = applyControlMessage({
      search: 'foo=1&state=b&open=true',
      controls: CONTROLS,
      message: { kind: EProtoMessage.Reset },
    })
    expect(search).toBe('foo=1')
  })
})
