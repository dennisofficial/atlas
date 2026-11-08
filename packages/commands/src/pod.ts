export type CommandContext<Args> = {
  args: Args
  sessionId: string
  log: (message: string) => void
}

export type CommandResult = { kind: 'done' } | { kind: 'refused'; reason: string }

export type CommandHandler<Args> = (context: CommandContext<Args>) => Promise<CommandResult>
