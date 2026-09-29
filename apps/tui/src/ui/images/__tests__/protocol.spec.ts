import { describe, expect, test } from 'bun:test'

import { imageProtocolOf } from '../protocol'

describe('imageProtocolOf', () => {
  test('keeps the terminal-native protocol off Warp', () => {
    expect(imageProtocolOf({ env: { TERM_PROGRAM: 'iTerm.app' }, fallback: 'kitty' })).toBe('kitty')
    expect(imageProtocolOf({ env: { TERM_PROGRAM: 'ghostty' }, fallback: 'sixel' })).toBe('sixel')
    expect(imageProtocolOf({ env: {}, fallback: 'kitty' })).toBe('kitty')
  })

  test('downgrades Warp to the block sampler whatever OpenTUI resolved', () => {
    expect(imageProtocolOf({ env: { TERM_PROGRAM: 'WarpTerminal' }, fallback: 'kitty' })).toBe('blocks')
    expect(imageProtocolOf({ env: { TERM_PROGRAM: 'WarpTerminal' }, fallback: 'sixel' })).toBe('blocks')
    expect(imageProtocolOf({ env: { TERM_PROGRAM: 'WarpTerminal' }, fallback: 'blocks' })).toBe('blocks')
  })
})
