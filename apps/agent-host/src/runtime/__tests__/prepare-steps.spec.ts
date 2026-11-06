import { describe, expect, it } from 'bun:test'

import { EWorkspaceStep, EWorkspaceStepState, type WorkspaceStepReport } from '@dltech/atlas-core'

import { PrepareSteps } from '../prepare-steps'

describe('PrepareSteps', () => {
  it('replays steps reported before anyone listened, then forwards live ones', () => {
    const steps = new PrepareSteps()
    steps.report({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started })
    steps.report({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done })
    const seen: WorkspaceStepReport[] = []
    steps.subscribe((step) => seen.push(step))
    steps.report({ step: EWorkspaceStep.Daemon, state: EWorkspaceStepState.Done })
    expect(seen.map((step) => `${step.step}:${step.state}`)).toEqual([
      'sandbox:started',
      'sandbox:done',
      'daemon:done',
    ])
  })

  it('fails only the step that is open', () => {
    const steps = new PrepareSteps()
    const seen: WorkspaceStepReport[] = []
    steps.subscribe((step) => seen.push(step))
    steps.failOpen('nothing open')
    steps.report({ step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started })
    steps.failOpen('clone failed')
    steps.failOpen('again')
    expect(seen).toEqual([
      { step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Started },
      { step: EWorkspaceStep.Clone, state: EWorkspaceStepState.Failed, reason: 'clone failed' },
    ])
  })
})
