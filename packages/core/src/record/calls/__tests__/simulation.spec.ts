import { describe, expect, it } from 'bun:test'
import * as fc from 'fast-check'

import {
  checkState,
  explore,
  newSimulation,
  PERFECT_FLAGS,
  runSchedule,
  type EFlags,
  type Step,
} from './sim-explore'

const runExploration = (args: {
  callCount: 1 | 2
  readOnly: readonly boolean[]
  flags: EFlags
  maxCrashes?: number
  maxReboots?: number
}) =>
  explore({
    callCount: args.callCount,
    readOnly: args.readOnly,
    flags: args.flags,
    maxCrashes: args.maxCrashes ?? 2,
    maxReboots: args.maxReboots ?? 1,
  })

describe('call protocol simulation', () => {
  it('exhaustive 1 call: every interleaving with a crash at every step holds the invariants', () => {
    const { paths, states, failures } = runExploration({
      callCount: 1,
      readOnly: [false],
      flags: PERFECT_FLAGS,
    })
    expect(failures).toEqual([])
    expect(states).toBeGreaterThan(0)
    expect(paths).toBeGreaterThan(0)
  })

  it('exhaustive 2 calls: every interleaving with a crash at every step holds the invariants', () => {
    const { paths, states, failures } = runExploration({
      callCount: 2,
      readOnly: [false, false],
      flags: PERFECT_FLAGS,
      maxCrashes: 2,
      maxReboots: 1,
    })
    expect(failures).toEqual([])
    expect(states).toBeGreaterThan(0)
    expect(paths).toBeGreaterThan(0)
  })

  it('fast-check: random schedules hold the invariants', () => {
    const stepArb: fc.Arbitrary<Step> = fc.oneof(
      fc.constant({ kind: 'crash' } as Step),
      fc.constant({ kind: 'daemonReboot' } as Step),
      fc.constantFrom('key-0', 'key-1').chain((key) =>
        fc.oneof(
          fc.constant({ kind: 'exit', key } as Step),
          fc
            .constantFrom(0, 1)
            .chain((host) =>
              fc.oneof(
                fc.constant({ kind: 'dispatch', host, key } as Step),
                fc.constant({ kind: 'collect', host, key } as Step),
                fc.constant({ kind: 'recordResult', host, key } as Step),
                fc.constant({ kind: 'ack', host, key } as Step),
                fc.constant({ kind: 'recover', host, key } as Step),
              ),
            ),
        ),
      ),
    )
    const scheduleArb = fc.array(stepArb, { minLength: 0, maxLength: 16 })
    fc.assert(
      fc.property(scheduleArb, (schedule) => {
        const sim = newSimulation({ callCount: 2, readOnly: [false, false], flags: PERFECT_FLAGS })
        runSchedule(sim, schedule)
        return checkState(sim).length === 0
      }),
      { numRuns: 500 },
    )
  })
})

describe('mutation checks', () => {
  it('a host acking before the result commits breaks the invariants', () => {
    const { failures } = runExploration({
      callCount: 1,
      readOnly: [false],
      flags: { ...PERFECT_FLAGS, ackBeforeCommit: true },
    })
    expect(failures.length).toBeGreaterThan(0)
  })

  it('the daemon spawning before journaling breaks the invariants', () => {
    const { failures } = runExploration({
      callCount: 1,
      readOnly: [false],
      flags: { ...PERFECT_FLAGS, spawnWithoutJournal: true },
    })
    expect(failures.length).toBeGreaterThan(0)
  })

  it('recovery running a call on a changed bootId breaks the invariants', () => {
    const { failures } = runExploration({
      callCount: 1,
      readOnly: [false],
      flags: { ...PERFECT_FLAGS, runAcrossBoot: true },
    })
    expect(failures.length).toBeGreaterThan(0)
  })
})
