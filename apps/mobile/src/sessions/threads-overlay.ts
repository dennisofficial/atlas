export const OVERLAY_WIDTH_RATIO = 0.55
export const OVERLAY_MIN_WIDTH = 320
export const OVERLAY_BACKDROP_ALPHA = 0.3
export const OVERLAY_ANIMATION_MS = 200

export const overlayWidthOf = (width: number): number =>
  Math.min(width, Math.max(OVERLAY_MIN_WIDTH, Math.round(width * OVERLAY_WIDTH_RATIO)))
