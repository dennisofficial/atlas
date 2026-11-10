import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { PaneRect } from '../pane-command'
import { coveredOf, samplePointsOf, sameRect, windowRectOf } from '../pane-geometry'

const elementWith = (rect: { left: number; top: number; width: number; height: number }) => {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  })
  return element
}

beforeAll(() => {
  GlobalRegistrator.register()
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

describe('windowRectOf', () => {
  it('reads the rect in window coordinates with y growing down', () => {
    const element = elementWith({ left: 512, top: 64, width: 704, height: 832 })
    expect(windowRectOf(element)).toEqual({ x: 512, y: 64, width: 704, height: 832 })
  })

  it('keeps subpixel edges instead of rounding them', () => {
    const element = elementWith({ left: 512.25, top: 64.5, width: 703.5, height: 832.75 })
    expect(windowRectOf(element)).toEqual({ x: 512.25, y: 64.5, width: 703.5, height: 832.75 })
  })

  it('sends where a scrolled panel is on screen, not where it starts in the document', () => {
    const element = elementWith({ left: 0, top: 40, width: 800, height: 200 })
    document.body.style.height = '4000px'
    window.scrollTo(0, 1200)
    expect(window.scrollY).toBeGreaterThan(0)
    expect(windowRectOf(element)).toEqual({ x: 0, y: 40, width: 800, height: 200 })
    window.scrollTo(0, 0)
  })
})

describe('sameRect', () => {
  const rect: PaneRect = { x: 1, y: 2, width: 3, height: 4 }

  it('compares every edge exactly', () => {
    expect(sameRect(rect, { ...rect })).toBe(true)
    expect(sameRect(rect, { ...rect, y: 2.5 })).toBe(false)
    expect(sameRect(undefined, rect)).toBe(false)
  })
})

describe('samplePointsOf', () => {
  it('probes the centre and each corner, inside the pane', () => {
    const points = samplePointsOf({ x: 10, y: 20, width: 100, height: 50 })
    expect(points).toEqual([
      { x: 60, y: 45 },
      { x: 11, y: 21 },
      { x: 109, y: 21 },
      { x: 11, y: 69 },
      { x: 109, y: 69 },
    ])
  })

  it('has nothing to probe when the pane is too small to hold an inset', () => {
    expect(samplePointsOf({ x: 0, y: 0, width: 2, height: 800 })).toEqual([])
    expect(samplePointsOf({ x: 0, y: 0, width: 800, height: 0 })).toEqual([])
  })
})

describe('coveredOf', () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 }

  it('is not covered while the app paints nothing over the pane', () => {
    const slot = document.createElement('div')
    expect(coveredOf({ slot, rect, topAt: () => null })).toBe(false)
    expect(coveredOf({ slot, rect, topAt: () => slot })).toBe(false)
    const child = document.createElement('span')
    slot.append(child)
    expect(coveredOf({ slot, rect, topAt: () => child })).toBe(false)
  })

  it('is covered when anything the app paints sits above the pane', () => {
    const dialog = document.createElement('div')
    const slot = document.createElement('div')
    document.body.append(dialog, slot)
    expect(coveredOf({ slot, rect, topAt: () => document.body })).toBe(true)
    expect(coveredOf({ slot, rect, topAt: () => dialog })).toBe(true)
  })
})
