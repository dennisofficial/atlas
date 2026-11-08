import {
  awaitsReplyOf,
  EInputConsumed,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  type EventDraft,
  type InboxEntry,
  type ModelPort,
  type PluginEventBody,
  type RecordBody,
  visibleEvents,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { unfinishedCommandIdsOf, type ControlPlane } from '@dltech/atlas-control'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import type { CommandRegistry } from '@dltech/atlas-commands'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { CommandIntake, isCommandKind, type CommandHandlers } from './command-intake'
import type { SessionRecord } from './record/record-adapter'

export { INBOX_KIND_STOP }

export type InboxIntakeArgs = {
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  commands?: CommandRegistry | undefined
  handlers?: CommandHandlers | undefined
  model?: ModelPort | undefined
  log?: LogPort | undefined
}

export class InboxIntake implements AgentIntake {
  private readonly commandIntake: CommandIntake | undefined

  constructor(private readonly args: InboxIntakeArgs) {
    this.commandIntake =
      args.commands === undefined
        ? undefined
        : new CommandIntake({
            commands: args.commands,
            handlers: args.handlers ?? new Map(),
            sessionId: args.sessionId,
            model: args.model,
            visibleEvents: () => args.record.eventCache().visibleLoopEvents(),
            append: (drafts) => this.appendDrafts(drafts),
            log: args.log,
          })
  }

  async prepare(): Promise<PendingDrain> {
    const entries = await this.fetch()
    const drafts: EventDraft[] = []
    let wakesTurn = false
    for (const entry of entries) {
      if (entry.kind === INBOX_KIND_STOP) continue
      if (entry.kind === INBOX_KIND_RETRY) {
        await this.consumeQuietly(entry)
        continue
      }
      if (entry.kind === INBOX_KIND_MESSAGE) {
        const parsed = inboxMessageSchema.safeParse(JSON.parse(entry.payload))
        if (!parsed.success) {
          await this.consumeUnknown(entry)
          continue
        }
        const { text, media, uploads } = parsed.data
        drafts.push({
          type: 'user-said',
          text,
          ...(media === undefined || media.length === 0 ? {} : { media }),
          ...(uploads === undefined || uploads.length === 0 ? {} : { uploads }),
          requestId: `inbox:${entry.inboxId}`,
          inboxId: entry.inboxId,
        })
        wakesTurn = true
        continue
      }
      if (isCommandKind(entry.kind)) {
        await this.runCommand(entry)
        continue
      }
      await this.consumeUnknown(entry)
    }
    return { drafts, wakesTurn }
  }

  async recoverUnfinished(): Promise<void> {
    if (this.commandIntake === undefined) return
    const { sessionId, record } = this.args
    const visible = visibleEvents(record.eventCache().eventsAfter(0))
    for (const inboxId of unfinishedCommandIdsOf(visible)) {
      try {
        const entry = await this.args.plane.readInboxEntry({ sessionId, inboxId })
        if (entry === undefined || !isCommandKind(entry.kind)) continue
        this.args.log?.info({
          source: 'holder.intake',
          message: `re-running consumed command ${inboxId} of kind "${entry.kind}" after takeover`,
        })
        await this.commandIntake.replay({ entry })
      } catch (error) {
        this.args.log?.error({
          source: 'holder.intake',
          message: `re-running consumed command ${inboxId} failed`,
          ...logFieldsOf({ error }),
        })
      }
    }
  }

  private async runCommand(entry: InboxEntry): Promise<void> {
    const resolved = this.commandIntake?.resolve(entry)
    if (this.commandIntake === undefined || resolved === undefined) {
      await this.consumeUnknown(entry)
      return
    }
    if (await this.turnOpen()) return
    await this.commandIntake.run({ entry, ...resolved })
  }

  private async turnOpen(): Promise<boolean> {
    const state = await this.args.record.loopState({ threadId: this.args.threadId })
    return awaitsReplyOf(state)
  }

  private async appendDrafts(
    drafts: readonly (EventDraft | RecordBody | PluginEventBody)[],
  ): Promise<void> {
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts,
    })
  }

  private async consumeUnknown(entry: InboxEntry): Promise<void> {
    this.args.log?.warn({
      source: 'holder.intake',
      message: `inbox entry ${entry.inboxId} of kind "${entry.kind}" is consumed without a draft`,
    })
    await this.consumeQuietly(entry)
  }

  private async consumeQuietly(entry: InboxEntry): Promise<void> {
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts: [
        {
          type: 'input-consumed',
          inboxId: entry.inboxId,
          consumed: EInputConsumed.Discarded,
        },
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
