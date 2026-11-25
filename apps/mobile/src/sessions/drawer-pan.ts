export const DRAWER_PAN = {
  edgeWidth: 40,
  activeOffsetX: 10,
  failOffsetY: 40,
  minDistance: 40,
} as const

type TOffsetRange = [start: number, end: number]

type TTunablePan = {
  activeOffsetX: (range: TOffsetRange) => unknown
  failOffsetY: (range: TOffsetRange) => unknown
}

const isTunablePan = (value: unknown): value is TTunablePan =>
  typeof value === 'object' &&
  value !== null &&
  'activeOffsetX' in value &&
  typeof value.activeOffsetX === 'function' &&
  'failOffsetY' in value &&
  typeof value.failOffsetY === 'function'

export const tuneDrawerPan = <TGesture>(gesture: TGesture): TGesture => {
  if (!isTunablePan(gesture)) return gesture
  gesture.activeOffsetX([-DRAWER_PAN.activeOffsetX, DRAWER_PAN.activeOffsetX])
  gesture.failOffsetY([-DRAWER_PAN.failOffsetY, DRAWER_PAN.failOffsetY])
  return gesture
}
