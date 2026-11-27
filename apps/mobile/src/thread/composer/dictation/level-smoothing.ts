export const LEVEL_ATTACK_MS = 45

export const LEVEL_RELEASE_MS = 260

export const clampLevel = (level: number): number => {
  if (Number.isNaN(level)) return 0
  return Math.min(1, Math.max(0, level))
}

export const levelTimeConstantOf = ({ previous, target }: { previous: number; target: number }) =>
  target > previous ? LEVEL_ATTACK_MS : LEVEL_RELEASE_MS

export const smoothedLevelOf = ({
  previous,
  target,
  elapsedMs,
}: {
  previous: number
  target: number
  elapsedMs: number
}): number => {
  const from = clampLevel(previous)
  const to = clampLevel(target)
  if (elapsedMs <= 0) return from
  const tau = levelTimeConstantOf({ previous: from, target: to })
  const blend = 1 - Math.exp(-elapsedMs / tau)
  return clampLevel(from + (to - from) * blend)
}
