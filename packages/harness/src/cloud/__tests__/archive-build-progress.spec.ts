import { describe, expect, it } from 'bun:test'

import { createBuildProgressThrottle, type ArchiveBuildProgress } from '../archive-build-progress'

const at = (phase: ArchiveBuildProgress['phase'], files: number, bytes: number): ArchiveBuildProgress => ({
  phase,
  files,
  bytes,
})

describe('createBuildProgressThrottle', () => {
  it('always lets the first report through', () => {
    const seen: ArchiveBuildProgress[] = []
    const report = createBuildProgressThrottle({ report: (p) => seen.push(p), intervalMs: 250, now: () => 1000 })
    report(at('walking', 0, 0))
    expect(seen).toEqual([at('walking', 0, 0)])
  })

  it('coalesces reports inside the interval and passes later distinct ones', () => {
    const seen: ArchiveBuildProgress[] = []
    let now = 1000
    const report = createBuildProgressThrottle({ report: (p) => seen.push(p), intervalMs: 250, now: () => now })
    report(at('staging', 1, 10))
    now = 1100
    report(at('staging', 2, 20))
    report(at('staging', 3, 30))
    now = 1300
    report(at('staging', 4, 40))
    expect(seen).toEqual([at('staging', 1, 10), at('staging', 4, 40)])
  })

  it('drops an identical consecutive report even outside the interval', () => {
    const seen: ArchiveBuildProgress[] = []
    let now = 1000
    const report = createBuildProgressThrottle({ report: (p) => seen.push(p), intervalMs: 250, now: () => now })
    report(at('compressing', 5, 50))
    now = 5000
    report(at('compressing', 5, 50))
    expect(seen).toEqual([at('compressing', 5, 50)])
  })

  it('never lets a throwing reporter abort the build', () => {
    const report = createBuildProgressThrottle({
      report: () => {
        throw new Error('boom')
      },
      now: () => 1000,
    })
    expect(() => report(at('staging', 1, 1))).not.toThrow()
  })
})
