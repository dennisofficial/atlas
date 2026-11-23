import { contextPressure } from '../models/pressure'

export const AUTO_ROTATE_OFF = 0

export enum EAutoRotate {
  Hold = 'hold',
  AtTurnEnd = 'at-turn-end',
}

export function autoRotateAfterTurn(args: {
  used: number | null
  window: number | null
  atPercent: number
}): EAutoRotate {
  const { used, window, atPercent } = args
  if (atPercent <= AUTO_ROTATE_OFF) return EAutoRotate.Hold
  if (used === null || window === null || window <= 0) return EAutoRotate.Hold
  return contextPressure({ used, window }).percent >= atPercent
    ? EAutoRotate.AtTurnEnd
    : EAutoRotate.Hold
}
