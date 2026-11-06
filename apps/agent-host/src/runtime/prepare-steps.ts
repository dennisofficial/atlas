import {
  EWorkspaceStepState,
  type EWorkspaceStep,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import type { PrepareStepReporter } from '@dltech/atlas-host'

export class PrepareSteps {
  private listener: PrepareStepReporter | undefined
  private pending: WorkspaceStepReport[] = []
  private open: EWorkspaceStep | undefined

  report(step: WorkspaceStepReport): void {
    this.open = step.state === EWorkspaceStepState.Started ? step.step : undefined
    if (this.listener === undefined) {
      this.pending.push(step)
      return
    }
    this.listener(step)
  }

  failOpen(reason: string): void {
    if (this.open === undefined) return
    this.report({ step: this.open, state: EWorkspaceStepState.Failed, reason })
  }

  subscribe(listener: PrepareStepReporter): void {
    this.listener = listener
    const queued = this.pending
    this.pending = []
    for (const step of queued) listener(step)
  }
}
