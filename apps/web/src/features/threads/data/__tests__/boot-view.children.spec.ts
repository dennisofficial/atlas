import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepState,
  EPodState,
  type CloneRepoProgress,
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

describe('bootViewOf clone repos', () => {
  const cloneWith = (args: {
    state: EBootStepState
    repos?: CloneRepoProgress[]
  }): RecordedBootStep => ({
    ...step({ step: EBootStep.Clone, state: args.state, offsetMs: 3000 }),
    ...(args.repos === undefined ? {} : { repos: args.repos }),
  })

  const cloneStepOf = (clone: RecordedBootStep) =>
    bootViewOf({
      pod: pod(EPodState.Booting, [clone]),
      now: T0 + 10_000,
    })?.steps.find((entry) => entry.id === EBootStep.Clone)

  const repos: CloneRepoProgress[] = [
    { repo: 'acme/web', state: EBootStepState.Done },
    { repo: 'acme/api', state: EBootStepState.Running },
    {
      repo: 'acme/docs',
      state: EBootStepState.Error,
      error: 'Repository not found',
    },
  ]

  it('lists one child per repo named after the slash', () => {
    const clone = cloneStepOf(cloneWith({ state: EBootStepState.Running, repos }))
    expect(clone?.children).toEqual([
      { id: 'acme/web', label: 'web', state: EBootStepState.Done },
      { id: 'acme/api', label: 'api', state: EBootStepState.Running },
      {
        id: 'acme/docs',
        label: 'docs',
        state: EBootStepState.Error,
        detail: 'Repository not found',
      },
    ])
  })

  it('shows no children for a single repo or none', () => {
    const single = repos.slice(0, 1)
    expect(
      cloneStepOf(cloneWith({ state: EBootStepState.Running, repos: single })),
    ).not.toHaveProperty('children')
    expect(cloneStepOf(cloneWith({ state: EBootStepState.Running }))).not.toHaveProperty('children')
  })

  it('keeps the step done and the boot healthy when an extra repo errored', () => {
    const view = bootViewOf({
      pod: pod(EPodState.Booting, [cloneWith({ state: EBootStepState.Done, repos })]),
      now: T0 + 10_000,
    })
    const clone = view?.steps.find((entry) => entry.id === EBootStep.Clone)
    expect(clone?.state).toBe(EBootStepState.Done)
    expect(clone?.detail).toBeUndefined()
    expect(view?.state).not.toBe(EBootStepState.Error)
    expect(view?.error).toBeUndefined()
  })
})

describe('bootViewOf same-named repos', () => {
  it('keeps distinct ids for repos sharing a name', () => {
    const clone: RecordedBootStep = {
      step: EBootStep.Clone,
      state: EBootStepState.Running,
      at: isoAt(0),
      repos: [
        { repo: 'acme/web', state: EBootStepState.Done },
        { repo: 'other/web', state: EBootStepState.Running },
      ],
    }
    const view = bootViewOf({ pod: pod(EPodState.Booting, [clone]), now: T0 })
    const ids = view?.steps
      .find((entry) => entry.id === EBootStep.Clone)
      ?.children?.map((c) => c.id)
    expect(ids).toEqual(['acme/web', 'other/web'])
  })
})
