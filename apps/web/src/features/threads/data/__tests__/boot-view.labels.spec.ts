import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  EPodState,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

import { bootViewOf } from '../boot-view'

const T0 = Date.parse('2026-10-22T10:00:00.000Z')
const isoAt = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

const step = (args: {
  step: EBootStep
  state: EBootStepState
  offsetMs: number
}): RecordedBootStep => ({
  step: args.step,
  state: args.state,
  at: isoAt(args.offsetMs),
})

const pod = (state: EPodState, steps: RecordedBootStep[] = []): PodStatus => ({
  state,
  steps,
})

const allDone = [
  EBootStep.Provision,
  EBootStep.Serve,
  EBootStep.Clone,
  EBootStep.Settings,
  EBootStep.Context,
  EBootStep.Agent,
].flatMap((id, index) => [
  step({ step: id, state: EBootStepState.Running, offsetMs: index * 2000 }),
  step({ step: id, state: EBootStepState.Done, offsetMs: index * 2000 + 1000 }),
])

describe('bootViewOf step labels', () => {
  const labelsOf = (steps: RecordedBootStep[]) =>
    bootViewOf({
      pod: pod(EPodState.Booting, steps),
      now: T0 + 10_000,
    })?.steps.map((entry) => entry.label)

  const wake = (outcome: EBootStepOutcome): RecordedBootStep[] => [
    step({
      step: EBootStep.Provision,
      state: EBootStepState.Running,
      offsetMs: 0,
    }),
    {
      ...step({
        step: EBootStep.Provision,
        state: EBootStepState.Done,
        offsetMs: 1000,
      }),
      outcome,
    },
  ]

  it('says the sandbox was resumed and the repository is being checked, not cloned', () => {
    const labels = labelsOf([
      ...wake(EBootStepOutcome.Resumed),
      step({
        step: EBootStep.Clone,
        state: EBootStepState.Running,
        offsetMs: 2000,
      }),
    ])
    expect(labels?.[0]).toBe('Resume sandbox')
    expect(labels?.[2]).toBe('Check repository')
  })

  it('names what the clone step actually did once it reports its outcome', () => {
    const cloneDone = (outcome: EBootStepOutcome): RecordedBootStep => ({
      ...step({
        step: EBootStep.Clone,
        state: EBootStepState.Done,
        offsetMs: 3000,
      }),
      outcome,
    })
    expect(
      labelsOf([...wake(EBootStepOutcome.Resumed), cloneDone(EBootStepOutcome.Reused)])?.[2],
    ).toBe('Reuse repository')
    expect(
      labelsOf([...wake(EBootStepOutcome.Created), cloneDone(EBootStepOutcome.Cloned)]),
    ).toEqual([
      'Create sandbox',
      'Start Atlas',
      'Clone repository',
      'Run setup script',
      'Apply settings',
      'Load skills and instructions',
      'Start agent',
    ])
  })

  it('keeps the generic labels for steps recorded before outcomes existed', () => {
    expect(labelsOf(allDone)?.slice(0, 3)).toEqual([
      'Create sandbox',
      'Start Atlas',
      'Clone repository',
    ])
  })
})
