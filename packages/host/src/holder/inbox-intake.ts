import {
  EInputConsumed,
  INBOX_KIND_STOP,
  type EventDraft,
  type InboxEntry,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { SessionRecord } from './record/record-adapter'

export { INBOX_KIND_STOP }

export type InboxIntakeArgs = {
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  log?: LogPort | undefined
}

export class InboxIntake implements AgentIntake {
  constructor(private readonly args: InboxIntakeArgs) {}

  async prepare(): Promise<PendingDrain> {
    const entries = await this.fetch()
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
          inboxId: entry.inboxId,
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
      drafts: [
        { type: 'input-consumed', inboxId: entry.inboxId, consumed: EInputConsumed.Discarded },
      ],
    })
  }

  private async fetch(): Promise<InboxEntry[]> {
    try {
      return await this.args.plane.readInbox({
        sessionId: this.args.sessionId,
        afterId: 0,
        limit: 100,
      })
    } catch (error) {
      this.args.log?.error({
        source: 'holder.intake',
        message: 'reading the inbox failed',
        ...logFieldsOf({ error }),
      })
      throw error
    }
  }
}
