import { describe, expect, test } from 'bun:test'

import { radiusBase } from '../radius'
import { REM_PX, radius, radiusPx, typeScale } from '../scale'
import { font } from '../typography'

describe('native scale tokens', () => {
  test('radius in points matches the web radius base', () => {
    expect(radiusPx).toBe(Number.parseFloat(radiusBase) * REM_PX)
    expect(radius(0.6)).toBe(6)
  })

  test('type scale matches Tailwind text-xs through text-xl', () => {
    expect(typeScale.xs).toEqual({ fontSize: 12, lineHeight: 16 })
    expect(typeScale.sm).toEqual({ fontSize: 14, lineHeight: 20 })
    expect(typeScale.xl).toEqual({ fontSize: 20, lineHeight: 28 })
  })

  test('the native faces are the web font stacks first choices', () => {
    expect(font.sans.startsWith('"Geist"')).toBe(true)
    expect(font.mono.startsWith('"JetBrains Mono"')).toBe(true)
    expect(font.display.startsWith('"Space Grotesk"')).toBe(true)
  })
})
