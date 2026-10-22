import { describe, expect, it } from 'bun:test'

import { clippedImagePlacement } from '../image-placement'

const tall = { width: 375, height: 900 }
const layout = { x: 4, y: 10, width: 25, height: 30 }
const everything = { x: 0, y: 0, width: 500, height: 500 }

const place = (overrides: Partial<Parameters<typeof clippedImagePlacement>[0]> = {}) =>
  clippedImagePlacement({
    source: tall,
    layout,
    fitted: { width: 25, height: 30 },
    fit: 'fit',
    cellAspect: 2,
    pixels: { width: 200, height: 480 },
    clip: everything,
    ...overrides,
  })

describe('clippedImagePlacement', () => {
  it('returns the whole image when nothing clips it', () => {
    expect(place()).toEqual({
      destination: { x: 4, y: 10, width: 25, height: 30 },
      source: { x: 0, y: 0, width: 375, height: 900 },
      pixels: { width: 200, height: 480 },
    })
  })

  it('keeps only the bottom half of the source when the top 15 rows are clipped', () => {
    expect(place({ clip: { x: 0, y: 25, width: 500, height: 500 } })).toEqual({
      destination: { x: 4, y: 25, width: 25, height: 15 },
      source: { x: 0, y: 450, width: 375, height: 450 },
      pixels: { width: 200, height: 240 },
    })
  })

  it('keeps the same bottom half at 23x28 cells', () => {
    const result = place({
      source: tall,
      layout: { x: 0, y: 0, width: 23, height: 28 },
      fitted: { width: 23, height: 28 },
      pixels: { width: 184, height: 448 },
      clip: { x: 0, y: 14, width: 100, height: 100 },
    })

    expect(result).toEqual({
      destination: { x: 0, y: 14, width: 23, height: 14 },
      source: { x: 0, y: 450, width: 375, height: 450 },
      pixels: { width: 184, height: 224 },
    })
  })

  it('keeps the top half of the source when the bottom rows are clipped', () => {
    expect(place({ clip: { x: 0, y: 0, width: 500, height: 25 } })).toEqual({
      destination: { x: 4, y: 10, width: 25, height: 15 },
      source: { x: 0, y: 0, width: 375, height: 450 },
      pixels: { width: 200, height: 240 },
    })
  })

  it('crops the middle when both top and bottom are clipped', () => {
    const result = place({ clip: { x: 0, y: 20, width: 500, height: 10 } })

    expect(result?.destination).toEqual({ x: 4, y: 20, width: 25, height: 10 })
    expect(result?.source).toEqual({ x: 0, y: 300, width: 375, height: 300 })
    expect(result?.pixels).toEqual({ width: 200, height: 160 })
  })

  it('crops horizontally', () => {
    const result = place({ clip: { x: 9, y: 0, width: 10, height: 500 } })

    expect(result?.destination).toEqual({ x: 9, y: 10, width: 10, height: 30 })
    expect(result?.source).toEqual({ x: 75, y: 0, width: 150, height: 900 })
    expect(result?.pixels).toEqual({ width: 80, height: 480 })
  })

  it('returns null when the clip misses the image or is empty', () => {
    expect(place({ clip: { x: 0, y: 40, width: 500, height: 10 } })).toBeNull()
    expect(place({ clip: { x: 29, y: 0, width: 5, height: 500 } })).toBeNull()
    expect(place({ clip: { x: 0, y: 0, width: 0, height: 10 } })).toBeNull()
    expect(place({ clip: { x: 0, y: 0, width: 10, height: -1 } })).toBeNull()
  })

  it('returns null for nonpositive source, layout or fitted size', () => {
    expect(place({ source: { width: 0, height: 10 } })).toBeNull()
    expect(place({ layout: { x: 0, y: 0, width: 10, height: 0 } })).toBeNull()
    expect(place({ fitted: { width: 0, height: 5 } })).toBeNull()
  })

  it('offsets a letterboxed fit inside the layout and clips against the centred rectangle', () => {
    const base = {
      source: { width: 400, height: 400 },
      layout: { x: 2, y: 3, width: 40, height: 30 },
      fitted: { width: 20, height: 10 },
      pixels: { width: 100, height: 100 },
    }

    expect(place(base)?.destination).toEqual({ x: 12, y: 13, width: 20, height: 10 })

    const clipped = place({ ...base, clip: { x: 0, y: 18, width: 500, height: 500 } })
    expect(clipped?.destination).toEqual({ x: 12, y: 18, width: 20, height: 5 })
    expect(clipped?.source).toEqual({ x: 0, y: 200, width: 400, height: 200 })
    expect(clipped?.pixels).toEqual({ width: 100, height: 50 })
  })

  it('crops a wide source to the layout aspect for cover, then clips within that crop', () => {
    const base = {
      source: { width: 400, height: 100 },
      layout: { x: 0, y: 0, width: 20, height: 20 },
      fitted: { width: 20, height: 20 },
      fit: 'cover' as const,
      cellAspect: 1,
      pixels: { width: 100, height: 100 },
    }

    expect(place(base)?.source).toEqual({ x: 150, y: 0, width: 100, height: 100 })

    const clipped = place({ ...base, clip: { x: 0, y: 10, width: 20, height: 10 } })
    expect(clipped?.source).toEqual({ x: 150, y: 50, width: 100, height: 50 })
  })

  it('crops a tall source to the layout aspect for cover', () => {
    const result = place({
      source: { width: 100, height: 400 },
      layout: { x: 0, y: 0, width: 20, height: 20 },
      fitted: { width: 20, height: 20 },
      fit: 'cover',
      cellAspect: 1,
    })

    expect(result?.source).toEqual({ x: 0, y: 150, width: 100, height: 100 })
  })

  it('accounts for a cell twice as tall as it is wide when cropping for cover', () => {
    const result = place({
      source: { width: 100, height: 400 },
      layout: { x: 0, y: 0, width: 20, height: 20 },
      fitted: { width: 20, height: 20 },
      fit: 'cover',
    })

    expect(result?.source).toEqual({ x: 0, y: 100, width: 100, height: 200 })
  })

  it('returns null for cover with a nonpositive cell aspect', () => {
    expect(place({ fit: 'cover', cellAspect: 0 })).toBeNull()
  })

  it('treats fill like fit: the fitted size is already the draw size', () => {
    const result = place({
      fit: 'fill',
      layout: { x: 0, y: 0, width: 10, height: 10 },
      fitted: { width: 10, height: 10 },
      pixels: { width: 80, height: 80 },
      clip: { x: 0, y: 5, width: 10, height: 5 },
    })

    expect(result?.source).toEqual({ x: 0, y: 450, width: 375, height: 450 })
    expect(result?.pixels).toEqual({ width: 80, height: 40 })
  })

  it('reports zero pixels when the terminal resolution is unknown', () => {
    const result = place({
      pixels: { width: 0, height: 0 },
      clip: { x: 0, y: 25, width: 500, height: 500 },
    })

    expect(result?.pixels).toEqual({ width: 0, height: 0 })
    expect(result?.source).toEqual({ x: 0, y: 450, width: 375, height: 450 })
  })

  it('floors the source start and ceils the source end like the native clipper', () => {
    const result = place({
      source: { width: 10, height: 10 },
      layout: { x: 0, y: 0, width: 3, height: 3 },
      fitted: { width: 3, height: 3 },
      pixels: { width: 10, height: 10 },
      clip: { x: 0, y: 1, width: 3, height: 1 },
    })

    expect(result?.source).toEqual({ x: 0, y: 3, width: 10, height: 4 })
    expect(result?.pixels).toEqual({ width: 10, height: 4 })
  })

  it('never reaches past the source bitmap', () => {
    const result = place({
      source: { width: 7, height: 7 },
      layout: { x: 0, y: 0, width: 3, height: 3 },
      fitted: { width: 3, height: 3 },
      pixels: { width: 0, height: 0 },
      clip: { x: 0, y: 2, width: 3, height: 1 },
    })

    expect(result?.source.y).toBe(4)
    expect((result?.source.y ?? 0) + (result?.source.height ?? 0)).toBeLessThanOrEqual(7)
  })

  it('does not alter the caller inputs', () => {
    const input = {
      layout: { ...layout },
      fitted: { width: 25, height: 30 },
      clip: { x: 0, y: 25, width: 500, height: 500 },
    }
    place(input)

    expect(input.layout).toEqual(layout)
    expect(input.fitted).toEqual({ width: 25, height: 30 })
  })
})
