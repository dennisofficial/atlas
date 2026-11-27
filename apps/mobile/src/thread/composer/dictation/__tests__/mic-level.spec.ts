import { describe, expect, it } from 'bun:test'

import { MIC_CEILING_DB, MIC_FLOOR_DB, micLevelOf } from '../mic-level'

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

  it('maps loudness in decibels between the floor and the ceiling', () => {
    const amplitudeOf = (decibels: number) => Math.SQRT2 * 10 ** (decibels / 20)
    const middle = (MIC_FLOOR_DB + MIC_CEILING_DB) / 2
    expect(
      micLevelOf({ samples: toneOf({ peak: amplitudeOf(MIC_FLOOR_DB - 6), count: 512 }) }),
    ).toBe(0)
    expect(micLevelOf({ samples: toneOf({ peak: amplitudeOf(middle), count: 512 }) })).toBeCloseTo(
      0.5,
      1,
    )
    expect(
      micLevelOf({ samples: toneOf({ peak: amplitudeOf(MIC_CEILING_DB), count: 512 }) }),
    ).toBeCloseTo(1, 1)
  })

  it('shows quiet speech from an unprocessed iPhone microphone', () => {
    expect(micLevelOf({ samples: toneOf({ peak: 0.005, count: 512 }) })).toBeGreaterThan(0.2)
  })
})
