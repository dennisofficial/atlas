import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'

export class ChildIntake implements AgentIntake {
  private queued = 0

  accept(): void {
    this.queued += 1
  }

  get pending(): number {
    return this.queued
  }

  async prepare(): Promise<PendingDrain> {
    const wakesTurn = this.queued > 0
    this.queued = 0
    return { drafts: [], wakesTurn }
  }
}
