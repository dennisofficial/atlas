import {
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  INBOX_KIND_RETRY,
  INBOX_KIND_STOP,
  pendingInputsOf,
  type EventDraft,
  type InboxEntry,
  type ModelPort,
  type PluginEventBody,
  type RecordBody,
  type RunId,
  type ThreadId,
  userSaidOf,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import type { CommandRegistry } from '@dltech/atlas-commands'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
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
import {
  drainEventEntry,
  drainLoggedNotices,
  stagedMessageOf,
  type StagedMessage,
} from './notice-drain'
import type { OperatorAnswerIntake } from './operator-answer'
import type { SessionRecord } from './record/record-adapter'
import { recoverUnfinishedCommands } from './recover-unfinished-commands'
import {
  drainOrderOf,
  logStagedInputs,
  loggedMessagesOf,
  postedAndSaidOf,
  postedDraftsOf as postedDraftsFor,
  postedInboxIdsOf,
  type AppendDrafts,
  type Drainable,
} from './staged-log'
import { resolveWithdraws as applyWithdraws, type WithdrawLookup } from './withdraw-plan'
import { supersededRewindIdsOf } from './rewind-dedupe'

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
  private queue: Promise<unknown> = Promise.resolve()
  private staged = new Map<number, InboxEntry>()
  private readonly append: AppendDrafts = (drafts) => this.appendDrafts(drafts)

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

  async logStaged(
    args: { willDrain?: (() => boolean) | undefined; prepared?: (() => boolean) | undefined } = {},
  ): Promise<void> {
    await this.serial(async () => {
      await logStagedInputs({
        fetch: () => this.fetch(),
        willDrain: args.willDrain,
        prepared: args.prepared,
        resolveWithdraws: (entries) => this.resolveWithdraws(entries),
        postedDraftsOf: (entry) => this.postedDraftsOf(entry),
        appendDrafts: (drafts) => this.appendDrafts(drafts),
        log: this.args.log,
      })
    })
  }

  async prepare(): Promise<PendingDrain> {
    return await this.serial(() => this.drain())
  }

  /** Runs commands the holder already knows are safe to run outside a turn, without a model step. */
  async runCommands(entries: readonly InboxEntry[]): Promise<boolean> {
    if (this.commandIntake === undefined) return false
    return await this.serial(async () => {
      const glue = this.commandGlue()
      const superseded = supersededRewindIdsOf({
        entries,
        events: this.args.record.eventCache().eventsAfter(0),
      })
      let ran = false
      for (const entry of entries) {
        if (!isCommandKind(entry.kind)) continue
        if (superseded.has(entry.inboxId)) {
          await consumeQuietly({ ...glue, entry })
          ran = true
          continue
        }
        const resolved = this.commandIntake?.resolve(entry)
        if (resolved === undefined) continue
        await this.commandIntake?.run({ entry, ...resolved })
        ran = true
      }
      return ran
    })
  }

  private async drain(): Promise<PendingDrain> {
    const entries = await this.fetch()
    const resolved = await this.resolveWithdraws(entries)
    const superseded = supersededRewindIdsOf({
      entries,
      events: this.args.record.eventCache().eventsAfter(0),
    })
    const glue = this.commandGlue()
    const drainable: StagedMessage[] = []
    let wakesTurn = false
    for (const entry of entries) {
      if (resolved.has(entry.inboxId)) continue
      if (superseded.has(entry.inboxId)) {
        await consumeQuietly({ ...glue, entry })
        continue
      }
      if (entry.kind === INBOX_KIND_OPERATOR_ANSWER) {
        const answers = this.args.operatorAnswers
        if (answers !== undefined && (await answers.handle(entry)).wakesTurn) wakesTurn = true
        await consumeQuietly({ ...glue, entry })
        continue
      }
      if (entry.kind === INBOX_KIND_STOP) continue
      if (entry.kind === INBOX_KIND_RETRY) {
        await consumeQuietly({ ...glue, entry })
        continue
      }
      if (entry.kind === INBOX_KIND_EVENT || entry.kind === INBOX_KIND_RECORD) {
        if (await drainEventEntry({ entry, appendDrafts: this.append })) wakesTurn = true
        continue
      }
      if (entry.kind === INBOX_KIND_MESSAGE) {
        const stagedMessage = await stagedMessageOf({ entry, appendDrafts: this.append })
        if (stagedMessage !== undefined) drainable.push(stagedMessage)
        continue
      }
      if (isCommandKind(entry.kind)) {
        await runCommand({ ...glue, entry })
        continue
      }
      await consumeUnknown({ ...glue, entry })
    }
    const loggedWakes = await drainLoggedNotices({
      events: this.args.record.eventCache().eventsAfter(0),
      staged: new Set(entries.map((entry) => entry.inboxId)),
      appendDrafts: this.append,
    })
    if (loggedWakes) wakesTurn = true
    const order = drainOrderOf({
      staged: drainable,
      logged: loggedMessagesOf(this.args.record.eventCache().eventsAfter(0)),
      posted: postedInboxIdsOf({ events: this.args.record.eventCache().eventsAfter(0) }),
    })
    if (order.length > 0) await this.cancelOpenForMessage()
    for (const item of order) {
      await this.appendDrafts(this.drainDraftsOf(item))
      wakesTurn = true
    }
    await runLoggedCommands({
      ...glue,
      events: this.args.record.eventCache().eventsAfter(0),
      readEntry: (inboxId) =>
        this.args.plane.readInboxEntry({ sessionId: this.args.sessionId, inboxId }),
    })
    return { drafts: [], wakesTurn }
  }

  private async serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return await run
  }

  async recoverUnfinished(): Promise<void> {
    if (this.commandIntake === undefined) return
    await recoverUnfinishedCommands({
      intake: this.commandIntake,
      plane: this.args.plane,
      sessionId: this.args.sessionId,
      record: this.args.record,
      log: this.args.log,
    })
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
      pendingOf: (inboxId) =>
        pendingInputsOf(this.args.record.eventCache().eventsAfter(0)).pending.find(
          (pending) => pending.inboxId === inboxId,
        ),
      postedDraftsOf: (entry) => this.postedDraftsOf(entry),
    }
  }

  private drainDraftsOf(item: Drainable): (EventDraft | RecordBody | PluginEventBody)[] {
    if (item.posted || item.entry === undefined) {
      return [userSaidOf({ inboxId: item.inboxId, message: item.message })]
    }
    return postedAndSaidOf({ entry: item.entry, message: item.message })
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
