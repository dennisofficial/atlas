import { describe, expect, test } from 'bun:test'

import { availableSpace, EViewportKind, fitViewport, formatZoom } from '../fit-viewport'
import {
  clampDimension,
  describeViewport,
  formatViewportParam,
  FULL_VIEWPORT,
  parseViewportParam,
  rotateViewport,
  VIEWPORT_PRESETS,
} from '../viewport-param'

const fixed = (width: number, height: number) =>
  ({ kind: EViewportKind.Fixed, width, height }) as const

describe('fitViewport', () => {
  test('full fills the available space without scaling', () => {
    expect(
      fitViewport({ viewport: FULL_VIEWPORT, available: { width: 900, height: 700 } }),
    ).toEqual({ width: 900, height: 700, scale: 1 })
  })

  test('contain-fits by the tighter axis', () => {
    const fit = fitViewport({ viewport: fixed(1920, 1080), available: { width: 960, height: 900 } })
    expect(fit).toEqual({ width: 1920, height: 1080, scale: 0.5 })
    const tall = fitViewport({ viewport: fixed(390, 844), available: { width: 800, height: 422 } })
    expect(tall.scale).toBe(0.5)
  })

  test('never scales above 1', () => {
    expect(
      fitViewport({ viewport: fixed(390, 844), available: { width: 2000, height: 2000 } }).scale,
    ).toBe(1)
  })

  test('keeps the CSS size exactly W×H', () => {
    const fit = fitViewport({ viewport: fixed(1280, 800), available: { width: 640, height: 400 } })
    expect([fit.width, fit.height]).toEqual([1280, 800])
  })

  test('an empty stage yields scale 0 rather than NaN', () => {
    expect(
      fitViewport({ viewport: fixed(100, 100), available: { width: 0, height: 0 } }).scale,
    ).toBe(0)
  })
})

describe('availableSpace', () => {
  test('full uses the whole container, fixed subtracts stage padding', () => {
    const container = { width: 1000, height: 800 }
    expect(availableSpace({ viewport: FULL_VIEWPORT, container })).toEqual(container)
    expect(availableSpace({ viewport: fixed(1, 1), container })).toEqual({
      width: 968,
      height: 768,
    })
  })
})

describe('viewport param', () => {
  test('parses WxH and falls back to full', () => {
    expect(parseViewportParam('1920x1080')).toEqual(fixed(1920, 1080))
    expect(parseViewportParam('full')).toEqual(FULL_VIEWPORT)
    expect(parseViewportParam(null)).toEqual(FULL_VIEWPORT)
    expect(parseViewportParam('12x')).toEqual(FULL_VIEWPORT)
  })

  test('clamps absurd sizes', () => {
    expect(parseViewportParam('5x99999')).toEqual(fixed(100, 10000))
    expect(clampDimension(250.4)).toBe(250)
  })

  test('round-trips through format', () => {
    expect(formatViewportParam(fixed(768, 1024))).toBe('768x1024')
    expect(formatViewportParam(FULL_VIEWPORT)).toBe('full')
  })

  test('rotate swaps width and height, full is unchanged', () => {
    expect(rotateViewport(fixed(768, 1024))).toEqual(fixed(1024, 768))
    expect(rotateViewport(FULL_VIEWPORT)).toBe(FULL_VIEWPORT)
  })

  test('presets follow Chrome DevTools responsive widths, widest first', () => {
    expect(VIEWPORT_PRESETS.map((preset) => preset.width)).toEqual([
      2560, 1440, 1024, 768, 425, 375, 320,
    ])
    expect(VIEWPORT_PRESETS.map((preset) => preset.label)).toEqual([
      '4K',
      'Laptop L',
      'Laptop',
      'Tablet',
      'Mobile L',
      'Mobile M',
      'Mobile S',
    ])
  })

  test('describes size and zoom', () => {
    const viewport = fixed(1920, 1080)
    const fit = fitViewport({ viewport, available: { width: 1190, height: 700 } })
    expect(describeViewport({ viewport, fit })).toBe('1920 × 1080 · 62%')
    expect(formatZoom(0.625)).toBe('63%')
  })
})
