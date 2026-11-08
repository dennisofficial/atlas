import {
  COMMAND_INBOX_PREFIX,
  type Command,
  type CommandContext,
  type CommandHandler,
  type CommandRegistry,
} from '@dltech/atlas-commands'
import {
  EInputConsumed,
  type Event,
  type EventDraft,
  type InboxEntry,
  type ModelPort,
  type RecordBody,
} from '@dltech/atlas-core'
import type { LogPort } from '@dltech/atlas-observability'

export const isCommandKind = (kind: string): boolean => kind.startsWith(COMMAND_INBOX_PREFIX)

export type CommandHandlers = ReadonlyMap<string, CommandHandler<unknown>>

export type CommandIntakeArgs = {
  commands: CommandRegistry
  handlers: CommandHandlers
  sessionId: string
  model?: ModelPort | undefined
  visibleEvents(): readonly Event[]
  append(drafts: readonly (EventDraft | RecordBody)[]): Promise<void>
  log?: LogPort | undefined
}

const payloadOf = (payload: string): unknown => {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

export class CommandIntake {
  constructor(private readonly args: CommandIntakeArgs) {}

  resolve(entry: InboxEntry): { command: Command; handler: CommandHandler<unknown> } | undefined {
    const command = this.args.commands.byInboxKind.get(entry.kind)
    const handler = this.args.handlers.get(entry.kind)
    if (command === undefined || handler === undefined) return undefined
    return { command, handler }
  }

  async run(params: {
    entry: InboxEntry
    command: Command
    handler: CommandHandler<unknown>
  }): Promise<void> {
    const { entry, command, handler } = params
    const { inboxId } = entry
    await this.args.append([{ type: 'input-consumed', inboxId, consumed: EInputConsumed.Command }])
    const parsed = command.spec.args.safeParse(payloadOf(entry.payload))
    if (!parsed.success) {
      await this.refuse({ inboxId, reason: parsed.error.message })
      return
    }
    const context: CommandContext<unknown> = {
      args: parsed.data,
      sessionId: this.args.sessionId,
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
