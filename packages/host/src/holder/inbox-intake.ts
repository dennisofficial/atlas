import {
  attachmentsOf,
  awaitsReplyOf,
  EInputConsumed,
  EMessageOrigin,
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
import { INBOX_KIND_OPERATOR_ANSWER } from '@dltech/atlas-plugin-operator/core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import { INBOX_INTAKE_MAX_PAGES, readInboxPages } from './held-inbox'
import { CommandIntake, isCommandKind, type CommandHandlers } from './command-intake'
import type { OperatorAnswerIntake, OperatorAnswerOutcome } from './operator-answer'
import type { SessionRecord } from './record/record-adapter'

export { INBOX_KIND_STOP }

export const UNKNOWN_COMMAND_MAX_AGE_MS = 60 * 60 * 1000

const overAge = (params: { postedAt: string; now: number }): boolean => {
  const posted = Date.parse(params.postedAt)
  return Number.isNaN(posted) || params.now - posted > UNKNOWN_COMMAND_MAX_AGE_MS
}

export type InboxIntakeArgs = {
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  commands?: CommandRegistry | undefined
  handlers?: CommandHandlers | undefined
  model?: ModelPort | undefined
  operatorAnswers?: OperatorAnswerIntake | undefined
  log?: LogPort | undefined
  now?: (() => number) | undefined
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
      if (entry.kind === INBOX_KIND_OPERATOR_ANSWER) {
        const answered = await this.answerOperator(entry)
        if (answered.wakesTurn) wakesTurn = true
        await this.consumeQuietly(entry)
        continue
      }
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
        await this.cancelOpenForMessage()
        const { text, via } = parsed.data
        const attachments = attachmentsOf(parsed.data)
        const sender = entry.senderSessionId
        const origin = sender === null ? via : EMessageOrigin.PeerAgent
        drafts.push({
          type: 'user-said',
          text,
          ...(sender === null ? {} : { sender: { session: sender } }),
          ...(origin === undefined ? {} : { via: origin }),
          ...(attachments.length === 0 ? {} : { attachments }),
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

  private async answerOperator(entry: InboxEntry): Promise<OperatorAnswerOutcome> {
    if (this.args.operatorAnswers === undefined) return { wakesTurn: false }
    return await this.args.operatorAnswers.handle(entry)
  }

  private async cancelOpenForMessage(): Promise<void> {
    if (this.args.operatorAnswers === undefined) return
    await this.args.operatorAnswers.cancelOpen({
      reason: 'the operator sent a message instead of answering',
    })
  }

  private async runCommand(entry: InboxEntry): Promise<void> {
    const resolved = this.commandIntake?.resolve(entry)
    if (this.commandIntake === undefined || resolved === undefined) {
      await this.leaveUnknownCommand(entry)
      return
    }
    if (await this.turnOpen()) return
    await this.commandIntake.run({ entry, ...resolved })
  }

  private async leaveUnknownCommand(entry: InboxEntry): Promise<void> {
    const now = (this.args.now ?? Date.now)()
    if (overAge({ postedAt: entry.postedAt, now })) {
      await this.consumeUnknown(entry)
      return
    }
    this.args.log?.info({
      source: 'holder.intake',
      message: `inbox entry ${entry.inboxId} of kind "${entry.kind}" is left for a holder that knows the kind`,
    })
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
      return await readInboxPages({
        plane: this.args.plane,
        sessionId: this.args.sessionId,
        maxPages: INBOX_INTAKE_MAX_PAGES,
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
