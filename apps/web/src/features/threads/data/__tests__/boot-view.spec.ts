import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  EPodState,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

import {
  bootViewOf,
  FAILED_FALLBACK,
  isPodFailed,
  isPodLiveEligible,
  isPodSettled,
} from '../boot-view'

const T0 = Date.parse('2026-10-22T10:00:00.000Z')
const isoAt = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

const step = (args: {
  step: EBootStep
  state: EBootStepState
  offsetMs: number
  error?: string
}): RecordedBootStep => ({
  step: args.step,
  state: args.state,
  at: isoAt(args.offsetMs),
  ...(args.error === undefined ? {} : { error: args.error }),
})

const pod = (state: EPodState, steps: RecordedBootStep[] = []): PodStatus => ({
  state,
  steps,
})

const ALL_STEPS = [
  EBootStep.Provision,
  EBootStep.Serve,
  EBootStep.Clone,
  EBootStep.Context,
  EBootStep.Settings,
  EBootStep.Agent,
]

const allDone = ALL_STEPS.flatMap((id, index) => [
  step({ step: id, state: EBootStepState.Running, offsetMs: index * 2000 }),
  step({ step: id, state: EBootStepState.Done, offsetMs: index * 2000 + 1000 }),
])

describe('bootViewOf', () => {
  it('is null before the pod is loaded and for a pod that never started', () => {
    expect(bootViewOf({ pod: null, now: T0 })).toBeNull()
    expect(bootViewOf({ pod: pod(EPodState.None), now: T0 })).toBeNull()
    expect(bootViewOf({ pod: pod(EPodState.Running), now: T0 })).toBeNull()
  })

  it('hides the boot block for a parked pod, even with the last boot attempt recorded', () => {
    expect(bootViewOf({ pod: pod(EPodState.Parked), now: T0 })).toBeNull()
    expect(bootViewOf({ pod: pod(EPodState.Parked, allDone), now: T0 })).toBeNull()
  })

  it('shows every step pending while booting before the first step lands', () => {
    const view = bootViewOf({ pod: pod(EPodState.Booting), now: T0 })
    expect(view?.state).toBe(EBootStepState.Pending)
    expect(view?.steps.map((entry) => entry.state)).toEqual(
      ALL_STEPS.map(() => EBootStepState.Pending),
    )
    expect(view?.elapsedMs).toBeUndefined()
  })

  it('reports running with labels and elapsed time to now', () => {
    const view = bootViewOf({
      pod: pod(EPodState.Booting, [
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Running,
          offsetMs: 0,
        }),
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Done,
          offsetMs: 2000,
        }),
        step({
          step: EBootStep.Serve,
          state: EBootStepState.Running,
          offsetMs: 2500,
        }),
      ]),
      now: T0 + 9000,
    })
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.elapsedMs).toBe(9000)
    expect(view?.steps.map((entry) => entry.state)).toEqual([
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
      EBootStepState.Pending,
      EBootStepState.Pending,
      EBootStepState.Pending,
    ])
    expect(view?.steps[0]?.label).toBe('Create sandbox')
    expect(view?.steps[1]?.label).toBe('Start Atlas')
  })

  it('reports done with elapsed between the first and last step', () => {
    const view = bootViewOf({
      pod: pod(EPodState.Running, allDone),
      now: T0 + 999_000,
    })
    expect(view?.state).toBe(EBootStepState.Done)
    expect(view?.elapsedMs).toBe(11_000)
  })

  it('orders steps by time before folding them', () => {
    const view = bootViewOf({
      pod: pod(EPodState.Booting, [
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Done,
          offsetMs: 2000,
        }),
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Running,
          offsetMs: 0,
        }),
      ]),
      now: T0 + 3000,
    })
    expect(view?.steps[0]?.state).toBe(EBootStepState.Done)
  })

  it('surfaces the step error and no elapsed time on a failed pod', () => {
    const view = bootViewOf({
      pod: pod(EPodState.Failed, [
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Running,
          offsetMs: 0,
        }),
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Error,
          offsetMs: 1000,
          error: 'No Vercel credential',
        }),
      ]),
      now: T0 + 5000,
    })
    expect(view?.state).toBe(EBootStepState.Error)
    expect(view?.error).toBe('No Vercel credential')
    expect(view?.steps[0]).toMatchObject({
      state: EBootStepState.Error,
      detail: 'No Vercel credential',
    })
    expect(view?.elapsedMs).toBeUndefined()
  })

  it('fails the running step and falls back to a generic error when the pod failed silently', () => {
    const view = bootViewOf({
      pod: pod(EPodState.Failed, [
        step({
          step: EBootStep.Provision,
          state: EBootStepState.Done,
          offsetMs: 0,
        }),
        step({
          step: EBootStep.Serve,
          state: EBootStepState.Running,
          offsetMs: 1000,
        }),
      ]),
      now: T0 + 5000,
    })
    expect(view?.state).toBe(EBootStepState.Error)
    expect(view?.error).toBe(FAILED_FALLBACK)
    expect(view?.steps[1]?.state).toBe(EBootStepState.Error)
  })

  it('shows a failed pod with no steps as an error', () => {
    const view = bootViewOf({ pod: pod(EPodState.Failed), now: T0 })
    expect(view?.state).toBe(EBootStepState.Error)
    expect(view?.error).toBe(FAILED_FALLBACK)
  })
})

describe('isPodSettled', () => {
  it('settles on failed, and on running once every step is done or none were recorded', () => {
    expect(isPodSettled(pod(EPodState.Failed))).toBe(true)
    expect(isPodSettled(pod(EPodState.Running))).toBe(true)
    expect(isPodSettled(pod(EPodState.Running, allDone))).toBe(true)
    expect(
      isPodSettled(
        pod(EPodState.Running, [
          step({
            step: EBootStep.Provision,
            state: EBootStepState.Done,
            offsetMs: 0,
          }),
          step({
            step: EBootStep.Serve,
            state: EBootStepState.Running,
            offsetMs: 1,
          }),
        ]),
      ),
    ).toBe(false)
    expect(isPodSettled(pod(EPodState.Booting))).toBe(false)
    expect(isPodSettled(pod(EPodState.None))).toBe(false)
  })
})

describe('isPodFailed', () => {
  it('is true only for a failed pod, never for a parked one', () => {
    expect(isPodFailed(pod(EPodState.Failed))).toBe(true)
    expect(isPodFailed(pod(EPodState.Parked))).toBe(false)
    expect(isPodFailed(pod(EPodState.Running))).toBe(false)
    expect(isPodFailed(null)).toBe(false)
  })
})

describe('isPodLiveEligible', () => {
  it('is true only for a running pod whose agent step is done', () => {
    expect(isPodLiveEligible(null)).toBe(false)
    expect(isPodLiveEligible(pod(EPodState.Booting))).toBe(false)
    expect(isPodLiveEligible(pod(EPodState.Parked))).toBe(false)
    expect(isPodLiveEligible(pod(EPodState.Failed))).toBe(false)
    expect(isPodLiveEligible(pod(EPodState.Running, allDone))).toBe(true)
  })

  it('is false while the running pod is still booting the agent', () => {
    expect(isPodLiveEligible(pod(EPodState.Running, allDone.slice(0, 5)))).toBe(false)
  })
})

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
      'Load skills and instructions',
      'Apply settings',
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
