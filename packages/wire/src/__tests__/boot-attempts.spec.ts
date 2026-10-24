import { describe, expect, it } from 'bun:test'

import {
  bootAttemptsOf,
  EBootStep,
  EBootStepState,
  latestBootAttemptOf,
  type RecordedBootStep,
} from '../boot-progress-wire'

const { Provision, Serve, Agent } = EBootStep
const { Running, Done, Error: Failed } = EBootStepState

const T0 = Date.parse('2026-10-24T10:00:00.000Z')

const history = (...steps: [EBootStep, EBootStepState][]): RecordedBootStep[] =>
  steps.map(([step, state], index) => ({
    step,
    state,
    at: new Date(T0 + index * 1000).toISOString(),
  }))

const shapeOf = (attempts: RecordedBootStep[][]) =>
  attempts.map((attempt) => attempt.map(({ step, state }) => [step, state]))

describe('bootAttemptsOf', () => {
  it('is empty for no history', () => {
    expect(bootAttemptsOf([])).toEqual([])
  })

  it('starts a new attempt at every Provision/Running after the first boot', () => {
    const attempts = bootAttemptsOf(
      history(
        [Provision, Running],
        [Provision, Done],
        [Agent, Done],
        [Provision, Running],
        [Provision, Done],
        [Serve, Running],
      ),
    )
    expect(shapeOf(attempts)).toEqual([
      [
        [Provision, Running],
        [Provision, Done],
        [Agent, Done],
      ],
      [
        [Provision, Running],
        [Provision, Done],
        [Serve, Running],
      ],
    ])
  })

  it('keeps the claim and the boot reporter Provision/Running in one attempt', () => {
    const attempts = bootAttemptsOf(
      history([Provision, Running], [Provision, Running], [Provision, Done]),
    )
    expect(attempts).toHaveLength(1)
  })

  it('starts an attempt at a Provision step of any state once the last one finished', () => {
    const attempts = bootAttemptsOf(
      history([Provision, Done], [Serve, Running], [Provision, Failed], [Serve, Running]),
    )
    expect(shapeOf(attempts)).toEqual([
      [
        [Provision, Done],
        [Serve, Running],
      ],
      [
        [Provision, Failed],
        [Serve, Running],
      ],
    ])
  })

  it('orders the history by time before splitting it', () => {
    const [first, second] = history([Provision, Running], [Provision, Done])
    if (first === undefined || second === undefined) throw new Error('fixture')
    expect(shapeOf(bootAttemptsOf([second, first]))).toEqual([
      [
        [Provision, Running],
        [Provision, Done],
      ],
    ])
  })
})

describe('latestBootAttemptOf', () => {
  it('is the last attempt, or empty for no history', () => {
    expect(latestBootAttemptOf([])).toEqual([])
    const steps = history([Provision, Running], [Provision, Failed], [Provision, Running])
    expect(shapeOf([latestBootAttemptOf(steps)])).toEqual([[[Provision, Running]]])
  })
})
