import type { EventDraft } from '@dltech/atlas-core'

export class GroupRunState {
  private running = false

  constructor(private readonly stamp: (draft: EventDraft) => EventDraft) {}

  get runningForGroup(): boolean {
    return this.running
  }

  started(): void {
    this.running = true
  }

  ended(draft: EventDraft): EventDraft {
    this.running = false
    return this.stamp(draft)
  }
}
