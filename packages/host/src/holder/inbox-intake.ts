import {
  INBOX_KIND_STOP,
  pendingInputsOf,
  type EventDraft,
  type InboxEntry,
  type ModelPort,
  type PluginEventBody,
  type RecordBody,
  type RunId,
  type ThreadId,
  type V2Event,
  userSaidOf,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { AgentIntake, PendingDrain } from '@dltech/atlas-agent'
import type { CommandRegistry } from '@dltech/atlas-commands'
import type { LogPort } from '@dltech/atlas-observability'

import {
  consumeQuietly,
  runLoggedCommands,
  turnOpenOf,
  type CommandGlue,
} from './command-intake-glue'
import { CommandIntake, isCommandKind, type CommandHandlers } from './command-intake'
import { EIntakeScope, intakeThreadOf, skipsInChildScope } from './intake-scope'
import { fetchInboxEntries, INBOX_INTAKE_MAX_PAGES, logPendingInputIdsOf } from './held-inbox'
import { drainEntries } from './intake-entries'
import { drainLoggedNotices } from './notice-drain'
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
import { resolveWithdraws, type WithdrawLookup } from './withdraw-plan'
import { supersededRewindIdsOf } from './rewind-dedupe'

const consumedInboxIdsOf = (events: readonly V2Event[]): ReadonlySet<number> =>
  new Set(events.flatMap((event) => (event.type === 'input-consumed' ? [event.inboxId] : [])))

export { INBOX_KIND_STOP }

export type InboxIntakeArgs = {
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  scope: EIntakeScope
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
    const child = this.args.scope === EIntakeScope.Child
    await this.serial(async () => {
      await logStagedInputs({
        fetch: () => this.fetch(),
        willDrain: args.willDrain,
        prepared: args.prepared,
        resolveWithdraws: (entries) => this.withdrawsOf(entries),
        skips: child ? skipsInChildScope : undefined,
        postedDraftsOf: (entry) => this.postedDraftsOf(entry),
        appendDrafts: (drafts) => this.appendDrafts(drafts),
        log: this.args.log,
      })
    })
  }

  async prepare(): Promise<PendingDrain> {
    return await this.serial(() => this.drain())
  }

  async stage(): Promise<void> {
    await this.logStaged({ willDrain: () => false, prepared: () => true })
  }

  async hasQueued(): Promise<boolean> {
    return await this.serial(async () => {
      const entries = await this.fetch()
      return entries.length > 0 || logPendingInputIdsOf(this.events()).length > 0
    })
  }

  /** Runs commands the holder already knows are safe to run outside a turn, without a model step. */
  async runCommands(entries: readonly InboxEntry[]): Promise<boolean> {
    if (this.commandIntake === undefined) return false
    return await this.serial(async () => {
      const glue = this.commandGlue()
      const events = this.events()
      const superseded = supersededRewindIdsOf({ entries, events })
      const consumed = consumedInboxIdsOf(events)
      let ran = false
      for (const entry of entries) {
        if (!isCommandKind(entry.kind) || consumed.has(entry.inboxId)) continue
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
    const resolved = await this.withdrawsOf(entries)
    const before = this.events()
    const superseded =
      this.args.scope === EIntakeScope.Main
        ? supersededRewindIdsOf({ entries, events: before })
        : new Set<number>()
    const drained = await drainEntries({
      entries,
      scope: this.args.scope,
      resolved,
      superseded,
      glue: this.commandGlue(),
      appendDrafts: this.append,
      operatorAnswers: this.args.operatorAnswers,
    })
    const events = this.events()
    const noticesWake = await drainLoggedNotices({
      events,
      staged: new Set(entries.map((entry) => entry.inboxId)),
      appendDrafts: this.append,
    })
    const order = drainOrderOf({
      staged: drained.drainable,
      logged: loggedMessagesOf(events),
      posted: postedInboxIdsOf({ events }),
    })
    if (order.length > 0) await this.cancelOpenForMessage()
    for (const item of order) await this.appendDrafts(this.drainDraftsOf(item))
    await runLoggedCommands({
      ...this.commandGlue(),
      events: before,
      readEntry: (inboxId) =>
        this.args.plane.readInboxEntry({ sessionId: this.args.sessionId, inboxId }),
    })
    return { drafts: [], wakesTurn: drained.wakesTurn || noticesWake || order.length > 0 }
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

  private events(): V2Event[] {
    return this.args.record.eventCache().eventsAfter(0)
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

  private async withdrawsOf(entries: readonly InboxEntry[]): Promise<ReadonlySet<number>> {
    if (this.args.scope !== EIntakeScope.Main) return new Set<number>()
    return await resolveWithdraws({
      entries,
      lookup: this.withdrawLookup(),
      appendDrafts: (drafts) => this.appendDrafts(drafts),
    })
  }

  private withdrawLookup(): WithdrawLookup {
    return {
      stagedOf: (inboxId) => this.staged.get(inboxId),
      pendingOf: (inboxId) =>
        pendingInputsOf(this.events()).pending.find((pending) => pending.inboxId === inboxId),
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
    if (this.args.scope !== EIntakeScope.Main || this.args.operatorAnswers === undefined) return
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
    const entries = await fetchInboxEntries({
      plane: this.args.plane,
      sessionId: this.args.sessionId,
      forThread: intakeThreadOf(this.args),
      maxPages: INBOX_INTAKE_MAX_PAGES,
      log: this.args.log,
    })
    this.staged = new Map(entries.map((entry) => [entry.inboxId, entry]))
    return entries
  }
}
