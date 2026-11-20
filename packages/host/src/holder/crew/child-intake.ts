import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import type { EventDraft } from '@dltech/atlas-core'

export class ChildIntake implements AgentIntake {
  private drafts: EventDraft[] = []
  private signals = 0

  accept(draft?: EventDraft): void {
    this.signals += 1
    if (draft !== undefined) this.drafts.push(draft)
  }

  get pending(): number {
    return this.signals
  }

  async prepare(): Promise<PendingDrain> {
    const drafts = this.drafts
    const wakesTurn = this.signals > 0
    this.drafts = []
    this.signals = 0
    return { drafts, wakesTurn }
  }
}
