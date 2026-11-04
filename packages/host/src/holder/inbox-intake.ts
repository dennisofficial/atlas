import type { EventDraft, InboxEntry, RunId, ThreadId } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { SessionRecord } from './record/record-adapter'

export const INBOX_KIND_STOP = 'stop'

export type InboxIntakeArgs = {
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  onStop?: ((inboxId: number) => void) | undefined
  log?: LogPort | undefined
}

export class InboxIntake implements AgentIntake {
  private afterId = 0
  private stopAfterId = 0
  private stopSeen: number | undefined
  private lastStopConsumed = 0

  constructor(private readonly args: InboxIntakeArgs) {}

  takeStop(): number | undefined {
    const found = this.stopSeen
    this.stopSeen = undefined
    if (found === undefined || found <= this.lastStopConsumed) return undefined
    return found
  }

  hasPendingStop(): boolean {
    return this.stopSeen !== undefined && this.stopSeen > this.lastStopConsumed
  }

  stopConsumed(inboxId: number): void {
    if (inboxId > this.lastStopConsumed) this.lastStopConsumed = inboxId
  }

  async pollStops(): Promise<void> {
    const entries = await this.fetch({ afterId: this.stopAfterId })
    const last = entries[entries.length - 1]
    if (last !== undefined) this.stopAfterId = last.inboxId
    for (const entry of entries) {
      if (entry.kind !== INBOX_KIND_STOP) continue
      if (entry.inboxId <= this.lastStopConsumed) continue
      if (this.stopSeen === undefined) {
        this.stopSeen = entry.inboxId
        this.args.onStop?.(entry.inboxId)
      }
    }
  }

  async prepare(): Promise<PendingDrain> {
    const entries = await this.fetch({ afterId: this.afterId })
    const last = entries[entries.length - 1]
    if (last !== undefined) this.afterId = last.inboxId
    const drafts: EventDraft[] = []
    let wakesTurn = false
    for (const entry of entries) {
      if (entry.kind === INBOX_KIND_STOP) continue
      if (entry.kind === INBOX_KIND_MESSAGE) {
        const parsed = inboxMessageSchema.safeParse(JSON.parse(entry.payload))
        if (!parsed.success) {
          await this.consumeUnknown(entry)
          continue
        }
        drafts.push({
          type: 'user-said',
          text: parsed.data.text,
          requestId: `inbox:${entry.inboxId}`,
        })
        wakesTurn = true
        continue
      }
      await this.consumeUnknown(entry)
    }
    return { drafts, wakesTurn }
  }

  private async consumeUnknown(entry: InboxEntry): Promise<void> {
    this.args.log?.warn({
      source: 'holder.intake',
      message: `inbox entry ${entry.inboxId} of kind "${entry.kind}" is consumed without a draft`,
    })
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts: [{ type: 'input-consumed', inboxId: entry.inboxId }],
    })
  }

  private async fetch(args: { afterId: number }): Promise<InboxEntry[]> {
    try {
      return await this.args.plane.readInbox({
        sessionId: this.args.sessionId,
        afterId: args.afterId,
        limit: 100,
      })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.intake',
        message: 'reading the inbox failed',
        ...logFieldsOf({ error }),
      })
      return []
    }
  }
}
