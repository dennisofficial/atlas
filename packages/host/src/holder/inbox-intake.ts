import {
  attachmentsOf,
  EMessageOrigin,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  pendingInputsOf,
  visibleEvents,
  type EventDraft,
  type InboxEntry,
  type ModelPort,
  type PluginEventBody,
  type RecordBody,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'
import { unfinishedCommandIdsOf, type ControlPlane } from '@dltech/atlas-control'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import type { CommandRegistry } from '@dltech/atlas-commands'
import { INBOX_KIND_MESSAGE, inboxMessageSchema, type InboxMessage } from '@dltech/atlas-protocol'
import { INBOX_KIND_OPERATOR_ANSWER } from '@dltech/atlas-plugin-operator/core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import {
  consumeQuietly,
  consumeUnknown,
  runCommand,
  runLoggedCommands,
  turnOpenOf,
  type CommandGlue,
} from './command-intake-glue'
import { CommandIntake, isCommandKind, type CommandHandlers } from './command-intake'
import { INBOX_INTAKE_MAX_PAGES, readInboxPages } from './held-inbox'
import type { OperatorAnswerIntake, OperatorAnswerOutcome } from './operator-answer'
import type { SessionRecord } from './record/record-adapter'
import {
  jsonOf,
  logStagedInputs,
  postedDraftsOf as postedDraftsFor,
  postedInboxIdsOf,
  salvagedFieldsOf,
} from './staged-log'
import { resolveWithdraws as applyWithdraws, type WithdrawLookup } from './withdraw-plan'

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
  operatorAnswers?: OperatorAnswerIntake | undefined
  log?: LogPort | undefined
  now?: (() => number) | undefined
}

export class InboxIntake implements AgentIntake {
  private readonly commandIntake: CommandIntake | undefined
  private staged = new Map<number, InboxEntry>()

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

  async logStaged(): Promise<void> {
    await logStagedInputs({
      fetch: () => this.fetch(),
      resolveWithdraws: (entries) => this.resolveWithdraws(entries),
      postedDraftsOf: (entry) => this.postedDraftsOf(entry),
      appendDrafts: (drafts) => this.appendDrafts(drafts),
      log: this.args.log,
    })
  }

  async prepare(): Promise<PendingDrain> {
    const entries = await this.fetch()
    const resolved = await this.resolveWithdraws(entries)
    const glue = this.commandGlue()
    const drafts: EventDraft[] = []
    let wakesTurn = false
    for (const entry of entries) {
      if (resolved.has(entry.inboxId)) continue
      if (entry.kind === INBOX_KIND_OPERATOR_ANSWER) {
        const answered = await this.answerOperator(entry)
        if (answered.wakesTurn) wakesTurn = true
        await consumeQuietly({ ...glue, entry })
        continue
      }
      if (entry.kind === INBOX_KIND_STOP) continue
      if (entry.kind === INBOX_KIND_RETRY) {
        await consumeQuietly({ ...glue, entry })
        continue
      }
      if (entry.kind === INBOX_KIND_MESSAGE) {
        const parsed = inboxMessageSchema.safeParse(jsonOf(entry.payload))
        if (!parsed.success) {
          await this.appendDrafts([
            {
              type: 'input-refused',
              inboxId: entry.inboxId,
              reason: 'unreadable message',
              ...salvagedFieldsOf(entry.payload),
            },
          ])
          continue
        }
        await this.cancelOpenForMessage()
        await this.appendDrafts([...this.postedDraftsOf(entry), this.saidDraft(entry, parsed.data)])
        wakesTurn = true
        continue
      }
      if (isCommandKind(entry.kind)) {
        await runCommand({ ...glue, entry })
        continue
      }
      await consumeUnknown({ ...glue, entry })
    }
    for (const pending of this.stagedMessages()) {
      await this.appendDrafts([this.saidDraft(pending.entry, pending.message)])
      wakesTurn = true
    }
    await runLoggedCommands({
      ...glue,
      events: this.args.record.eventCache().eventsAfter(0),
      readEntry: (inboxId) =>
        this.args.plane.readInboxEntry({ sessionId: this.args.sessionId, inboxId }),
    })
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

  private commandGlue(): CommandGlue {
    return {
      commandIntake: this.commandIntake,
      appendDrafts: (drafts) => this.appendDrafts(drafts),
      turnOpen: () => turnOpenOf({ record: this.args.record, threadId: this.args.threadId }),
      now: this.args.now ?? Date.now,
      log: this.args.log,
    }
  }

  private postedDraftsOf(entry: InboxEntry): RecordBody[] {
    return postedDraftsFor({
      entry,
      resolveCommand: (target) => this.commandIntake?.resolve(target),
    })
  }

  private async resolveWithdraws(entries: readonly InboxEntry[]): Promise<ReadonlySet<number>> {
    return await applyWithdraws({
      entries,
      lookup: this.withdrawLookup(),
      appendDrafts: (drafts) => this.appendDrafts(drafts),
    })
  }

  private withdrawLookup(): WithdrawLookup {
    return {
      stagedOf: (inboxId) => this.staged.get(inboxId),
      postedInboxIds: () =>
        postedInboxIdsOf({ events: this.args.record.eventCache().eventsAfter(0) }),
      postedDraftsOf: (entry) => this.postedDraftsOf(entry),
    }
  }

  private saidDraft(entry: InboxEntry, message: InboxMessage): EventDraft {
    const { text, via } = message
    const attachments = attachmentsOf(message)
    const sender = entry.senderSessionId
    const origin = sender === null ? via : EMessageOrigin.PeerAgent
    return {
      type: 'user-said',
      text,
      ...(sender === null ? {} : { sender: { session: sender } }),
      ...(origin === undefined ? {} : { via: origin }),
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(message.clientId === undefined ? {} : { clientId: message.clientId }),
      requestId: `inbox:${entry.inboxId}`,
      inboxId: entry.inboxId,
    }
  }

  private stagedMessages(): { entry: InboxEntry; message: InboxMessage }[] {
    const posted = pendingInputsOf(this.args.record.eventCache().eventsAfter(0))
    return posted.pending.flatMap((pending) => {
      if (pending.kind !== INBOX_KIND_MESSAGE || pending.text === undefined) return []
      return [
        {
          entry: {
            sessionId: this.args.sessionId,
            inboxId: pending.inboxId,
            kind: pending.kind,
            payload: JSON.stringify({
              text: pending.text,
              ...(pending.attachments === undefined ? {} : { attachments: pending.attachments }),
            }),
            postedAt: pending.at,
            consumedSeq: pending.seq,
            senderSessionId: null,
          },
          message: {
            text: pending.text,
            ...(pending.clientId === undefined ? {} : { clientId: pending.clientId }),
            ...(pending.attachments === undefined ? {} : { attachments: [...pending.attachments] }),
          },
        },
      ]
    })
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

  private async appendDrafts(
    drafts: readonly (EventDraft | RecordBody | PluginEventBody)[],
  ): Promise<void> {
    await this.args.record.append({
      threadId: this.args.threadId,
      runId: this.args.runId(),
      drafts,
    })
  }

  private async fetch(): Promise<InboxEntry[]> {
    try {
      const entries = await readInboxPages({
        plane: this.args.plane,
        sessionId: this.args.sessionId,
        maxPages: INBOX_INTAKE_MAX_PAGES,
      })
      this.staged = new Map(entries.map((entry) => [entry.inboxId, entry]))
      return entries
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
