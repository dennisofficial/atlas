import { clampLevel } from './level-smoothing'

export const MIC_GAIN = 9

export const micLevelOf = ({ samples }: { samples: Float32Array }): number => {
  if (samples.length === 0) return 0
  let power = 0
  for (const sample of samples) power += sample * sample
  return clampLevel(Math.sqrt(power / samples.length) * MIC_GAIN)
}

export const micLevelOfBuffer = ({ data }: { data: ArrayBuffer }): number =>
  micLevelOf({ samples: new Float32Array(data) })
