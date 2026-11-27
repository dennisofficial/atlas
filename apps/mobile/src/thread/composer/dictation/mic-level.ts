import { clampLevel } from './level-smoothing'

export const MIC_FLOOR_DB = -60

export const MIC_CEILING_DB = -15

const FULL_SCALE = 32768

export const micDecibelsOf = ({ samples }: { samples: Int16Array }): number => {
  if (samples.length === 0) return Number.NEGATIVE_INFINITY
  let power = 0
  for (const sample of samples) {
    const value = sample / FULL_SCALE
    power += value * value
  }
  return 20 * Math.log10(Math.sqrt(power / samples.length))
}

export const micLevelOf = ({ samples }: { samples: Int16Array }): number => {
  const decibels = micDecibelsOf({ samples })
  if (!Number.isFinite(decibels)) return 0
  return clampLevel((decibels - MIC_FLOOR_DB) / (MIC_CEILING_DB - MIC_FLOOR_DB))
}
