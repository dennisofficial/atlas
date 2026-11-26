export const MAX_ZOOM_SCALE = 5
export const DOUBLE_TAP_SCALE = 2.5
export const DOUBLE_TAP_MS = 300
export const DISMISS_PULL = 96

const ZOOMED_SCALE = 1.01

export type Size = { width: number; height: number }
export type Point = { x: number; y: number }
export type Rect = Point & Size

const clamp = (args: { value: number; max: number }): number =>
  Math.min(Math.max(args.value, 0), Math.max(args.max, 0))

export const isZoomed = (zoomScale: number): boolean => zoomScale > ZOOMED_SCALE

export const isDoubleTap = (args: { previousAt: number | undefined; at: number }): boolean =>
  args.previousAt !== undefined && args.at - args.previousAt <= DOUBLE_TAP_MS

export const zoomRectOf = (args: { point: Point; viewport: Size; zoomScale: number }): Rect => {
  if (isZoomed(args.zoomScale)) return { x: 0, y: 0, ...args.viewport }
  const width = args.viewport.width / DOUBLE_TAP_SCALE
  const height = args.viewport.height / DOUBLE_TAP_SCALE
  return {
    x: clamp({ value: args.point.x - width / 2, max: args.viewport.width - width }),
    y: clamp({ value: args.point.y - height / 2, max: args.viewport.height - height }),
    width,
    height,
  }
}

export const shouldDismiss = (args: { pullY: number; zoomScale: number }): boolean =>
  !isZoomed(args.zoomScale) && args.pullY <= -DISMISS_PULL
