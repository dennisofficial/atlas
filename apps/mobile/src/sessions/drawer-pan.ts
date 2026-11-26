export const DRAWER_PAN = {
  edgeWidth: 40,
  closeEdgeWidth: 28,
  activeOffsetX: 10,
  failOffsetY: 40,
  minDistance: 40,
} as const

type TOffsetRange = [start: number, end: number]

export type TEdgeHitSlop = { right: number; width: number }

type TTunablePan = {
  activeOffsetX: (range: TOffsetRange) => unknown
  failOffsetY: (range: TOffsetRange) => unknown
  hitSlop: (slop: TEdgeHitSlop) => unknown
}

const isTunablePan = (value: unknown): value is TTunablePan =>
  typeof value === 'object' &&
  value !== null &&
  'activeOffsetX' in value &&
  typeof value.activeOffsetX === 'function' &&
  'failOffsetY' in value &&
  typeof value.failOffsetY === 'function' &&
  'hitSlop' in value &&
  typeof value.hitSlop === 'function'

export const drawerPanTunerOf =
  ({ open }: { open: boolean }) =>
  <TGesture>(gesture: TGesture): TGesture => {
    if (!isTunablePan(gesture)) return gesture
    gesture.activeOffsetX([-DRAWER_PAN.activeOffsetX, DRAWER_PAN.activeOffsetX])
    gesture.failOffsetY([-DRAWER_PAN.failOffsetY, DRAWER_PAN.failOffsetY])
    if (open) gesture.hitSlop({ right: 0, width: DRAWER_PAN.closeEdgeWidth })
    return gesture
  }

export const rowSwipeHitSlopOf = ({ listEdgeInset }: { listEdgeInset: number }) => ({
  right: Math.min(0, listEdgeInset - DRAWER_PAN.closeEdgeWidth),
})
