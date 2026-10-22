import { describe, expect, test } from 'bun:test'

import { kittyImageTransportOf } from '../terminal-image-transport'

describe('native image transport', () => {
  test('compresses raw alpha-modified image payloads on Warp', () => {
    expect(kittyImageTransportOf({ env: { TERM_PROGRAM: 'WarpTerminal' } })).toBe('zlib')
  })

  test('leaves other terminal transports unchanged', () => {
    expect(kittyImageTransportOf({ env: { TERM_PROGRAM: 'ghostty' } })).toBe('raw')
    expect(kittyImageTransportOf({ env: {} })).toBe('raw')
  })

  test('applies the transport policy when booting the renderer', async () => {
    const source = await Bun.file(new URL('../boot.tsx', import.meta.url)).text()
    expect(source).toContain('kittyImageTransport: kittyImageTransportOf({ env: args.env })')
  })
})
