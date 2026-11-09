import { saidBody } from '@dltech/atlas-core'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'

export class ChildIntake implements AgentIntake {
  private queue: string[] = []

  push(text: string): void {
    this.queue.push(text)
  }

  get pending(): number {
    return this.queue.length
  }

  async prepare(): Promise<PendingDrain> {
    const texts = this.queue
    this.queue = []
    return { drafts: texts.map((text) => saidBody({ text })), wakesTurn: texts.length > 0 }
  }
}
