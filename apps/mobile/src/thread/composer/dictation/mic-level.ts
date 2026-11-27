import { clampLevel } from './level-smoothing'

export const MIC_GAIN = 9

const SILENT = 32768

export const micLevelOf = ({ samples }: { samples: Int16Array }): number => {
  if (samples.length === 0) return 0
  let power = 0
  for (const sample of samples) {
    const value = sample / SILENT
    power += value * value
  }
  return clampLevel(Math.sqrt(power / samples.length) * MIC_GAIN)
}
