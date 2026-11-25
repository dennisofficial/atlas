import { describe, expect, test } from 'bun:test'

import {
  cacheDiagramHeight,
  cachedDiagramHeight,
  clampDiagramHeight,
  DIAGRAM_ESTIMATE_HEIGHT,
  DIAGRAM_HEIGHT_CACHE_LIMIT,
  DIAGRAM_MAX_HEIGHT,
  DIAGRAM_MIN_HEIGHT,
  fitDiagramHeight,
} from '../diagram-layout'

describe('fitDiagramHeight', () => {
  test('scales the rendered height to the card width', () => {
    expect(fitDiagramHeight({ size: { width: 300, height: 150 }, targetWidth: 200 })).toBe(100)
  })

  test('falls back to the estimate when a size is missing', () => {
    expect(fitDiagramHeight({ size: { width: 0, height: 150 }, targetWidth: 200 })).toBe(
      DIAGRAM_ESTIMATE_HEIGHT,
    )
    expect(fitDiagramHeight({ size: { width: 300, height: 0 }, targetWidth: 200 })).toBe(
      DIAGRAM_ESTIMATE_HEIGHT,
    )
    expect(fitDiagramHeight({ size: { width: 300, height: 150 }, targetWidth: 0 })).toBe(
      DIAGRAM_ESTIMATE_HEIGHT,
    )
  })
})

describe('clampDiagramHeight', () => {
  test('caps a tall diagram and reports that it is capped', () => {
    expect(clampDiagramHeight(DIAGRAM_MAX_HEIGHT + 40)).toEqual({
      height: DIAGRAM_MAX_HEIGHT,
      clamped: true,
    })
  })

  test('keeps a short diagram and raises an empty one to the minimum', () => {
    expect(clampDiagramHeight(300)).toEqual({ height: 300, clamped: false })
    expect(clampDiagramHeight(10)).toEqual({ height: DIAGRAM_MIN_HEIGHT, clamped: false })
  })
})

describe('diagram height cache', () => {
  test('keys by the trimmed source and the rounded width', () => {
    cacheDiagramHeight({ source: '  graph TD\nA-->B  ', width: 320.4, height: 180 })
    expect(cachedDiagramHeight({ source: 'graph TD\nA-->B', width: 320 })).toBe(180)
    expect(cachedDiagramHeight({ source: 'graph TD\nA-->B', width: 375 })).toBeUndefined()
  })

  test('evicts the oldest entry when it is full', () => {
    const total = DIAGRAM_HEIGHT_CACHE_LIMIT * 2
    for (let index = 0; index < total; index++) {
      cacheDiagramHeight({ source: `diagram-${index}`, width: 320, height: index })
    }
    expect(cachedDiagramHeight({ source: 'diagram-0', width: 320 })).toBeUndefined()
    expect(cachedDiagramHeight({ source: `diagram-${total - 1}`, width: 320 })).toBe(total - 1)
  })
})
