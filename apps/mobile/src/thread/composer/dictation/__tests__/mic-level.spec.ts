import { describe, expect, it } from 'bun:test'

import { MIC_GAIN, micLevelOf } from '../mic-level'

const samplesOf = (values: readonly number[]): Int16Array => Int16Array.from(values)

const toneOf = ({ peak, count }: { peak: number; count: number }): Int16Array =>
  Int16Array.from(
    Array.from({ length: count }, (_, index) =>
      Math.round(32768 * peak * Math.sin((index / count) * Math.PI * 2)),
    ),
  )

describe('micLevelOf', () => {
  it('reads silence as no level', () => {
    expect(micLevelOf({ samples: samplesOf([0, 0, 0, 0]) })).toBe(0)
  })

  it('reads an empty buffer as no level', () => {
    expect(micLevelOf({ samples: samplesOf([]) })).toBe(0)
  })

  it('turns a full-scale tone into a level near one', () => {
    const level = micLevelOf({ samples: toneOf({ peak: 1, count: 512 }) })
    expect(level).toBeGreaterThan(0.6)
    expect(level).toBeLessThanOrEqual(1)
  })

  it('scales a quiet tone by the gain and clamps a loud one', () => {
    const quiet = micLevelOf({ samples: toneOf({ peak: 0.01, count: 512 }) })
    const loud = micLevelOf({ samples: toneOf({ peak: 0.5, count: 512 }) })
    expect(quiet).toBeCloseTo(0.01 * MIC_GAIN * Math.SQRT1_2, 3)
    expect(loud).toBe(1)
  })
})
