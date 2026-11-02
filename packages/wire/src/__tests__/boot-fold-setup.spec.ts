import { describe, expect, it } from 'bun:test'

import {
  BOOT_STEP_ORDER,
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  foldBootSteps,
} from '../boot-progress-wire'

describe('setup boot step', () => {
  it('orders Settings then Setup after Clone', () => {
    const clone = BOOT_STEP_ORDER.indexOf(EBootStep.Clone)
    expect(BOOT_STEP_ORDER[clone + 1]).toBe(EBootStep.Settings)
    expect(BOOT_STEP_ORDER[clone + 2]).toBe(EBootStep.Setup)
  })

  it('folds Setup as pending and keeps its outcome', () => {
    expect(foldBootSteps([])[EBootStep.Setup].state).toBe(EBootStepState.Pending)
    const folded = foldBootSteps([
      {
        step: EBootStep.Setup,
        state: EBootStepState.Done,
        outcome: EBootStepOutcome.SetupScriptFailed,
      },
    ])
    expect(folded[EBootStep.Setup].outcome).toBe(EBootStepOutcome.SetupScriptFailed)
  })
})
