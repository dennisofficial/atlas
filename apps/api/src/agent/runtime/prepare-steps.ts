import {
  EWorkspaceStepState,
  type EWorkspaceStep,
  type WorkspaceStepReport,
} from '@dltech/atlas-core'
import type { PrepareStepReporter } from '@dltech/atlas-host'

type ProducedStep = { step: WorkspaceStepReport; producedAtMs: number }

export class PrepareSteps {
  private listener: PrepareStepReporter | undefined
  private pending: ProducedStep[] = []
  private open: EWorkspaceStep | undefined
  private outputListener: ((text: string) => void) | undefined

  report(step: WorkspaceStepReport): void {
    this.open = step.state === EWorkspaceStepState.Started ? step.step : undefined
    const producedAtMs = Date.now()
    if (this.listener === undefined) {
      this.pending.push({ step, producedAtMs })
      return
    }
    this.listener(step, producedAtMs)
  }

  failOpen(reason: string): void {
    if (this.open === undefined) return
    this.report({ step: this.open, state: EWorkspaceStepState.Failed, reason })
  }

  output(text: string): void {
    this.outputListener?.(text)
  }

  subscribeOutput(listener: (text: string) => void): void {
    this.outputListener = listener
  }

  subscribe(listener: PrepareStepReporter): void {
    this.listener = listener
    const queued = this.pending
    this.pending = []
    for (const entry of queued) listener(entry.step, entry.producedAtMs)
  }
}
