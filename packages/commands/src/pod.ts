import type { Event, EventDraft, ModelPort, PluginEventBody, RecordBody } from '@dltech/atlas-core'

export type CommandContext<Args> = {
  args: Args
  sessionId: string
  inboxId: number
  model?: ModelPort | undefined
  visibleEvents(): readonly Event[]
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  log: (message: string) => void
}

export type CommandResult = { kind: 'done' } | { kind: 'refused'; reason: string }

export type CommandHandler<Args> = (context: CommandContext<Args>) => Promise<CommandResult>
