import type { ImageFit } from '@opentui/core'

export type ImageRectangle = { x: number; y: number; width: number; height: number }

type Size = { width: number; height: number }

export type ClippedImagePlacement = {
  destination: ImageRectangle
  source: ImageRectangle
  pixels: Size
}

const isPositive = (size: Size): boolean => size.width > 0 && size.height > 0

const centeredSource = (args: {
  source: Size
  layout: ImageRectangle
  fit: ImageFit
  cellAspect: number
}): ImageRectangle | null => {
  const full: ImageRectangle = { x: 0, y: 0, width: args.source.width, height: args.source.height }
  if (args.fit !== 'cover') return full
  if (args.cellAspect <= 0) return null

  const targetAspect = args.layout.width / (args.layout.height * args.cellAspect)
  const sourceAspect = args.source.width / args.source.height
  if (sourceAspect > targetAspect) {
    const width = Math.max(1, Math.round(args.source.height * targetAspect))
    return { ...full, x: Math.floor((args.source.width - width) / 2), width }
  }
  const height = Math.max(1, Math.round(args.source.width / targetAspect))
  return { ...full, y: Math.floor((args.source.height - height) / 2), height }
}

const intersect = (args: { a: ImageRectangle; b: ImageRectangle }): ImageRectangle | null => {
  const { a, b } = args
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.width, b.x + b.width)
  const y1 = Math.min(a.y + a.height, b.y + b.height)
  if (x0 >= x1 || y0 >= y1) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

const floorScaled = (args: { offset: number; extent: number; total: number }): number =>
  Math.floor((args.offset * args.extent) / args.total)

const ceilScaled = (args: { offset: number; extent: number; total: number }): number =>
  Math.floor((args.offset * args.extent + args.total - 1) / args.total)

const clipAxis = (args: {
  start: number
  end: number
  total: number
  sourceStart: number
  sourceExtent: number
  sourceLimit: number
}): { start: number; length: number } | null => {
  const from =
    args.sourceStart +
    floorScaled({ offset: args.start, extent: args.sourceExtent, total: args.total })
  const to =
    args.sourceStart +
    ceilScaled({ offset: args.end, extent: args.sourceExtent, total: args.total })
  const start = Math.min(from, args.sourceLimit - 1)
  const length = Math.min(to, args.sourceLimit) - start
  return length < 1 ? null : { start, length }
}

const clippedPixels = (args: { cells: number; fullCells: number; fullPixels: number }): number =>
  args.fullPixels === 0
    ? 0
    : ceilScaled({ offset: args.cells, extent: args.fullPixels, total: args.fullCells })

export function clippedImagePlacement(args: {
  source: Size
  layout: ImageRectangle
  fitted: Size
  fit: ImageFit
  cellAspect: number
  pixels: Size
  clip: ImageRectangle
}): ClippedImagePlacement | null {
  if (!isPositive(args.source) || !isPositive(args.layout) || !isPositive(args.fitted)) return null
  if (args.clip.width <= 0 || args.clip.height <= 0) return null

  const initialSource = centeredSource(args)
  if (!initialSource) return null

  const full: ImageRectangle = {
    x: args.layout.x + Math.floor((args.layout.width - args.fitted.width) / 2),
    y: args.layout.y + Math.floor((args.layout.height - args.fitted.height) / 2),
    width: args.fitted.width,
    height: args.fitted.height,
  }
  const visible = intersect({ a: full, b: args.clip })
  if (!visible) return null

  const left = visible.x - full.x
  const top = visible.y - full.y
  const columns = clipAxis({
    start: left,
    end: left + visible.width,
    total: full.width,
    sourceStart: initialSource.x,
    sourceExtent: initialSource.width,
    sourceLimit: args.source.width,
  })
  const rows = clipAxis({
    start: top,
    end: top + visible.height,
    total: full.height,
    sourceStart: initialSource.y,
    sourceExtent: initialSource.height,
    sourceLimit: args.source.height,
  })
  if (!columns || !rows) return null

  return {
    destination: visible,
    source: { x: columns.start, y: rows.start, width: columns.length, height: rows.length },
    pixels: {
      width: clippedPixels({
        cells: visible.width,
        fullCells: full.width,
        fullPixels: args.pixels.width,
      }),
      height: clippedPixels({
        cells: visible.height,
        fullCells: full.height,
        fullPixels: args.pixels.height,
      }),
    },
  }
}
