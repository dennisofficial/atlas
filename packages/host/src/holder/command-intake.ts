import {
  COMMAND_INBOX_PREFIX,
  type Command,
  type CommandContext,
  type CommandHandler,
  type CommandRegistry,
} from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import {
  EInputConsumed,
  type Event,
  type EventDraft,
  type InboxEntry,
  type InputMessage,
  type ModelPort,
  type PluginEventBody,
  type RecordBody,
  type V2Event,
} from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'

import {
  ETextPlan,
  planTextInput,
  type CommandHandlers,
  type ControlHandlers,
  type TextPlan,
} from './text-command'

export type { CommandHandlers, ControlHandlers } from './text-command'

export const isCommandKind = (kind: string): boolean => kind.startsWith(COMMAND_INBOX_PREFIX)

export type CommandIntakeArgs = {
  plane: ControlPlane
  commands: CommandRegistry
  handlers: CommandHandlers
  controlHandlers: ControlHandlers
  sessionId: string
  model?: ModelPort | undefined
  visibleEvents(): readonly Event[]
  loggedEvents(): readonly V2Event[]
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  log?: LogPort | undefined
}

type Resolved = { command: Command; handler: CommandHandler<unknown> }
type CommandPlan = Extract<TextPlan, { kind: ETextPlan.Command }>

const payloadOf = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class CommandIntake {
  constructor(private readonly args: CommandIntakeArgs) {}

  planText(text: string): TextPlan {
    return planTextInput({
      text,
      commands: this.args.commands,
      handlers: this.args.handlers,
      controlHandlers: this.args.controlHandlers,
    })
  }

  resolve(entry: InboxEntry): Resolved | undefined {
    const command = this.args.commands.byInboxKind.get(entry.kind)
    const handler = this.args.handlers.get(entry.kind)
    if (command === undefined || handler === undefined) return undefined
    return { command, handler }
  }

  async run(params: { entry: InboxEntry; command: Command; handler: CommandHandler<unknown> }) {
    const { inboxId } = params.entry
    await this.args.append([{ type: 'input-consumed', inboxId, consumed: EInputConsumed.Command }])
    const parsed = params.command.spec.args.safeParse(payloadOf(params.entry.payload))
    if (!parsed.success) {
      await this.refuse({ inboxId, reason: parsed.error.message })
      return
    }
    await this.invoke({ ...params, args: parsed.data })
  }

  async runText(params: {
    entry: InboxEntry
    message: InputMessage
    plan: TextPlan
  }): Promise<void> {
    const { inboxId } = params.entry
    await this.stageText(params)
    if (params.plan.kind === ETextPlan.Refused) {
      await this.refuse({ inboxId, reason: params.plan.reason })
      return
    }
    if (params.plan.kind !== ETextPlan.Command) return
    await this.args.append([
      {
        type: 'input-consumed',
        inboxId,
        consumed: EInputConsumed.Command,
        command: params.plan.consumed,
      },
    ])
    await this.invokePlan({ entry: params.entry, plan: params.plan })
  }

  async stageText(params: { entry: InboxEntry; message: InputMessage }): Promise<void> {
    if (this.isLogged(params.entry.inboxId)) return
    await this.args.append([
      {
        type: 'input-posted',
        inboxId: params.entry.inboxId,
        kind: params.entry.kind,
        postedAt: params.entry.postedAt,
        message: params.message,
      },
    ])
  }

  async replayText(params: { entry: InboxEntry; plan: TextPlan }): Promise<void> {
    if (params.plan.kind !== ETextPlan.Command) return
    await this.invokePlan({ entry: params.entry, plan: params.plan })
  }

  async replay({ entry }: { entry: InboxEntry }): Promise<void> {
    const resolved = this.resolve(entry)
    if (resolved === undefined) {
      this.args.log?.warn({
        source: 'holder.command',
        message: `inbox entry ${entry.inboxId} of kind "${entry.kind}" cannot be replayed: no handler`,
      })
      return
    }
    const parsed = resolved.command.spec.args.safeParse(payloadOf(entry.payload))
    if (!parsed.success) {
      await this.refuse({ inboxId: entry.inboxId, reason: parsed.error.message })
      return
    }
    await this.invoke({ entry, ...resolved, args: parsed.data })
  }

  private isLogged(inboxId: number): boolean {
    return this.args
      .loggedEvents()
      .some((event) => event.type === 'input-posted' && event.inboxId === inboxId)
  }

  private async invokePlan(params: { entry: InboxEntry; plan: CommandPlan }): Promise<void> {
    const { entry, plan } = params
    if ('pod' in plan.run) {
      await this.invoke({ entry, command: plan.command, handler: plan.run.pod, args: plan.args })
      return
    }
    try {
      await plan.run.control({
        plane: this.args.plane,
        sessionId: this.args.sessionId,
        args: plan.args,
      })
    } catch (error) {
      const reason = reasonOf(error)
      this.args.log?.error({
        source: 'holder.command',
        message: `${plan.command.spec.name} failed: ${reason}`,
      })
      await this.refuse({ inboxId: entry.inboxId, reason })
    }
  }

  private async invoke(params: {
    entry: InboxEntry
    command: Command
    handler: CommandHandler<unknown>
    args: unknown
  }): Promise<void> {
    const { entry, command, handler, args } = params
    const { inboxId } = entry
    const context: CommandContext<unknown> = {
      args,
      sessionId: this.args.sessionId,
      inboxId,
      model: this.args.model,
      visibleEvents: this.args.visibleEvents,
      append: this.args.append,
      log: (message) =>
        this.args.log?.info({
          source: 'holder.command',
          message: `${command.spec.name}: ${message}`,
        }),
    }
    const result = await handler(context)
    if (result.kind === 'refused') await this.refuse({ inboxId, reason: result.reason })
  }

  private async refuse(params: { inboxId: number; reason: string }): Promise<void> {
    await this.args.append([{ type: 'input-refused', ...params }])
  }
}
