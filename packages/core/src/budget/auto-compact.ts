import { contextPressure } from '../models/pressure'

export const AUTO_COMPACT_OFF = 0

export enum EAutoCompact {
  Hold = 'hold',
  AtTurnEnd = 'at-turn-end',
}

/**
 * Whether a settled turn has left the window full enough to summarise without being asked. Zero
 * turns the automatic trigger off, which is the operator saying they will run /compact themselves.
 */
export function autoCompactAfterTurn({
  used,
  window,
  atPercent,
}: {
  used: number
  window: number
  atPercent: number
}): EAutoCompact {
  if (atPercent <= AUTO_COMPACT_OFF) return EAutoCompact.Hold
  if (window <= 0) return EAutoCompact.Hold

  const { percent } = contextPressure({ used, window })
  return percent >= atPercent ? EAutoCompact.AtTurnEnd : EAutoCompact.Hold
}
