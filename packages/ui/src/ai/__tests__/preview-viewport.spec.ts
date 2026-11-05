import { describe, expect, it } from 'bun:test'

import {
  EViewportKind,
  FULL_VIEWPORT,
  MAX_DIMENSION,
  MIN_DIMENSION,
  STAGE_PADDING,
  availableSpace,
  fitViewport,
  formatViewportParam,
  formatZoom,
  parseViewportParam,
  rotateViewport,
  type Viewport,
} from '../internal/viewport'

const TABLET: Viewport = { kind: EViewportKind.Fixed, width: 768, height: 1024 }

describe('fitViewport', () => {
  it('fills the available space at full scale for the full viewport', () => {
    expect(
      fitViewport({ viewport: FULL_VIEWPORT, available: { width: 500, height: 300 } }),
    ).toEqual({
      width: 500,
      height: 300,
      scale: 1,
    })
  })

  it('never scales above 1', () => {
    const fit = fitViewport({ viewport: TABLET, available: { width: 5000, height: 5000 } })
    expect(fit.scale).toBe(1)
  })

  it('shrinks to the tighter axis', () => {
    const fit = fitViewport({ viewport: TABLET, available: { width: 384, height: 4000 } })
    expect(fit).toEqual({ width: 768, height: 1024, scale: 0.5 })
  })

  it('never goes negative with no space', () => {
    expect(fitViewport({ viewport: TABLET, available: { width: 0, height: 0 } }).scale).toBe(0)
  })
})

describe('availableSpace', () => {
  it('keeps the container for full and pads fixed sizes', () => {
    const container = { width: 400, height: 300 }
    expect(availableSpace({ viewport: FULL_VIEWPORT, container })).toEqual(container)
    expect(availableSpace({ viewport: TABLET, container })).toEqual({
      width: 400 - STAGE_PADDING * 2,
      height: 300 - STAGE_PADDING * 2,
    })
    expect(availableSpace({ viewport: TABLET, container: { width: 4, height: 4 } })).toEqual({
      width: 0,
      height: 0,
    })
  })
})

describe('viewport params', () => {
  it('round-trips fixed and full viewports', () => {
    expect(parseViewportParam(formatViewportParam(TABLET))).toEqual(TABLET)
    expect(parseViewportParam(formatViewportParam(FULL_VIEWPORT))).toEqual(FULL_VIEWPORT)
  })

  it('falls back to full for junk and clamps dimensions', () => {
    expect(parseViewportParam('nope')).toEqual(FULL_VIEWPORT)
    expect(parseViewportParam(null)).toEqual(FULL_VIEWPORT)
    expect(parseViewportParam('5x99999')).toEqual({
      kind: EViewportKind.Fixed,
      width: MIN_DIMENSION,
      height: MAX_DIMENSION,
    })
  })

  it('rotates fixed sizes and leaves full alone', () => {
    expect(rotateViewport(TABLET)).toEqual({ kind: EViewportKind.Fixed, width: 1024, height: 768 })
    expect(rotateViewport(FULL_VIEWPORT)).toEqual(FULL_VIEWPORT)
  })

  it('formats zoom as a percentage', () => {
    expect(formatZoom(0.5)).toBe('50%')
  })
})
