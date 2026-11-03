import { describe, expect, it } from 'bun:test'
import * as fc from 'fast-check'

import { EDaemonAnswer, recoverCall } from '../index'
import {
  actionsFor,
  checkState,
  cloneSim,
  explore,
  newSimulation,
  PERFECT_FLAGS,
  applyStep,
  type EFlags,
  type Step,
} from './sim-explore'

const runExploration = (args: {
  callCount: 1 | 2
  readOnly: readonly boolean[]
  flags: EFlags
  maxCrashes?: number
  maxReboots?: number
  stopOnFailure?: boolean
}) =>
  explore({
    callCount: args.callCount,
    readOnly: args.readOnly,
    flags: args.flags,
    maxCrashes: args.maxCrashes ?? 2,
    maxReboots: args.maxReboots ?? 0,
    stopOnFailure: args.stopOnFailure,
  })

describe('call protocol simulation', () => {
  it('exhaustive 1 call: every interleaving with a crash at every step holds the invariants', () => {
    const { paths, states, failures } = runExploration({
      callCount: 1,
      readOnly: [false],
      flags: PERFECT_FLAGS,
      maxCrashes: 2,
      maxReboots: 1,
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
      maxReboots: 0,
    })
    expect(failures).toEqual([])
    expect(states).toBeGreaterThan(0)
    expect(paths).toBeGreaterThan(0)
  }, 120_000)

  it('fast-check: well-formed random plays hold the invariants', () => {
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000 }), (seed) => {
        const sim = newSimulation({ callCount: 2, readOnly: [false, false], flags: PERFECT_FLAGS })
        let random = seed
        const next = (bound: number): number => {
          random = (random * 1103515245 + 12345) % 2147483648
          return random % bound
        }
        const steps = 6 + next(10)
        for (let index = 0; index < steps; index += 1) {
          const options = actionsFor(sim)
          const choices: readonly Step[] =
            next(4) === 0 ? [...options, { kind: 'crash' }, { kind: 'daemonReboot' }] : options
          if (choices.length === 0) break
          applyStep(sim, cloneStep(choices[next(choices.length)]))
        }
        return checkState(sim).length === 0
      }),
      { numRuns: 500 },
    )
  })
})

const cloneStep = (step: Step | undefined): Step => step ?? { kind: 'crash' }

describe('recoverCall covers the five-row table', () => {
  const facts = {
    dispatched: true,
    dispatchedBootId: 'b0',
    resultRecorded: false,
    readOnly: false,
  }

  it('result recorded -> ack, whatever the daemon says', () => {
    for (const answer of [EDaemonAnswer.Done, EDaemonAnswer.Running, EDaemonAnswer.NeverSeen]) {
      expect(
        recoverCall({ facts: { ...facts, resultRecorded: true }, answer, bootId: 'b0' }).type,
      ).toBe('ack')
    }
  })

  it('done -> record-result', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.Done, bootId: 'b0' }).type).toBe(
      'record-result',
    )
  })

  it('running -> attach', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.Running, bootId: 'b0' }).type).toBe('attach')
  })

  it('never seen, same bootId -> run (its first run)', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.NeverSeen, bootId: 'b0' }).type).toBe('run')
  })

  it('never seen, a changed bootId -> rerun read-only, interrupt the rest', () => {
    expect(recoverCall({ facts, answer: EDaemonAnswer.NeverSeen, bootId: 'b9' }).type).toBe(
      'interrupted',
    )
    expect(
      recoverCall({
        facts: { ...facts, readOnly: true },
        answer: EDaemonAnswer.NeverSeen,
        bootId: 'b9',
      }).type,
    ).toBe('rerun')
  })
})

describe('mutation checks', () => {
  const mutants: { name: string; flags: Partial<EFlags>; maxReboots: number }[] = [
    {
      name: 'a host acks before the result commits',
      flags: { ackBeforeCommit: true },
      maxReboots: 0,
    },
    {
      name: 'the daemon spawns before journaling',
      flags: { spawnWithoutJournal: true },
      maxReboots: 0,
    },
    {
      name: 'recovery reruns a non-read-only call on a changed bootId',
      flags: { rerunAcrossBoot: true },
      maxReboots: 1,
    },
    {
      name: 'recovery runs a call the daemon already has done',
      flags: { doneRuns: true },
      maxReboots: 0,
    },
    {
      name: 'recovery re-records a result instead of acking',
      flags: { recordedRecords: true },
      maxReboots: 0,
    },
    {
      name: 'a stale write commits (the commit fence is broken)',
      flags: { staleWriteCommits: true },
      maxReboots: 0,
    },
  ]

  for (const mutant of mutants) {
    it(`${mutant.name} breaks the invariants`, () => {
      const { failures } = runExploration({
        callCount: 1,
        readOnly: [false],
        flags: { ...PERFECT_FLAGS, ...mutant.flags },
        maxReboots: mutant.maxReboots,
        stopOnFailure: true,
      })
      expect(failures.length).toBeGreaterThan(0)
    })
  }
})
