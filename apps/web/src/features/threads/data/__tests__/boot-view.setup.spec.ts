import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  EPodState,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

import { bootViewOf, settledBootViewOf, SETUP_SCRIPT_FAILED_DETAIL } from '../boot-view'

const T0 = Date.parse('2026-11-02T10:00:00.000Z')

const rec = (args: {
  step: EBootStep
  state: EBootStepState
  at: number
  outcome?: EBootStepOutcome
}): RecordedBootStep => ({
  step: args.step,
  state: args.state,
  at: new Date(T0 + args.at).toISOString(),
  ...(args.outcome === undefined ? {} : { outcome: args.outcome }),
})

const doneSteps = (ids: EBootStep[], outcomes: Partial<Record<EBootStep, EBootStepOutcome>> = {}) =>
  ids.flatMap((step, index) => [
    rec({ step, state: EBootStepState.Running, at: index * 2000 }),
    rec({ step, state: EBootStepState.Done, at: index * 2000 + 1000, outcome: outcomes[step] }),
  ])

const BEFORE = [EBootStep.Provision, EBootStep.Serve, EBootStep.Clone]
const AFTER = [EBootStep.Settings, EBootStep.Context, EBootStep.Agent]

describe('setup script boot row', () => {
  it('labels the running step', () => {
    const view = bootViewOf({
      pod: {
        state: EPodState.Booting,
        steps: [
          ...doneSteps(BEFORE),
          rec({ step: EBootStep.Setup, state: EBootStepState.Running, at: 9000 }),
        ],
      },
      now: T0 + 10_000,
    })
    const row = view?.steps.find((entry) => entry.id === EBootStep.Setup)
    expect(row?.label).toBe('Run setup script')
    expect(row?.state).toBe(EBootStepState.Running)
  })

  it('names each outcome', () => {
    const labelOf = (outcome: EBootStepOutcome) =>
      bootViewOf({
        pod: {
          state: EPodState.Booting,
          steps: doneSteps([...BEFORE, EBootStep.Setup], { [EBootStep.Setup]: outcome }),
        },
        now: T0 + 20_000,
      })?.steps.find((entry) => entry.id === EBootStep.Setup)?.label
    expect(labelOf(EBootStepOutcome.NoSetupScript)).toBe('No setup script')
    expect(labelOf(EBootStepOutcome.SetupScriptSkipped)).toBe('Setup script already ran')
    expect(labelOf(EBootStepOutcome.SetupScriptFailed)).toBe('Setup script failed')
  })

  it('shows a failed script as Done with a non-error detail', () => {
    const view = settledBootViewOf(
      doneSteps([...BEFORE, EBootStep.Setup, ...AFTER], {
        [EBootStep.Setup]: EBootStepOutcome.SetupScriptFailed,
      }),
    )
    const row = view.steps.find((entry) => entry.id === EBootStep.Setup)
    expect(row?.state).toBe(EBootStepState.Done)
    expect(row?.detail).toBe(SETUP_SCRIPT_FAILED_DETAIL)
    expect(view.state).toBe(EBootStepState.Done)
    expect(view.error).toBeUndefined()
  })

  it('hides the row for boots by older serve releases', () => {
    const attempt = doneSteps([...BEFORE, ...AFTER])
    const view = settledBootViewOf(attempt)
    expect(view.steps.some((entry) => entry.id === EBootStep.Setup)).toBe(false)
    expect(view.state).toBe(EBootStepState.Done)
  })

  it('keeps the row pending before any later step is recorded', () => {
    const view = bootViewOf({
      pod: { state: EPodState.Booting, steps: doneSteps(BEFORE) },
      now: T0 + 10_000,
    })
    expect(view?.steps.find((entry) => entry.id === EBootStep.Setup)?.state).toBe(
      EBootStepState.Pending,
    )
  })
})
