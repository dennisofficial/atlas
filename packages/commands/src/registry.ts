import type { CommandSpec } from './spec'

export const COMMAND_INBOX_PREFIX = 'command:'

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

export type Command = Readonly<{ spec: Readonly<CommandSpec>; inboxKind: string }>

export type CommandRegistry = Readonly<{
  all: readonly Command[]
  byName: ReadonlyMap<string, Command>
  byInboxKind: ReadonlyMap<string, Command>
}>

export function defineCommand({ spec }: { spec: CommandSpec }): Command {
  if (!NAME_PATTERN.test(spec.name)) {
    throw new Error(`command name "${spec.name}" must be lowercase, without a slash`)
  }
  return Object.freeze({
    spec: Object.freeze({ ...spec }),
    inboxKind: `${COMMAND_INBOX_PREFIX}${spec.name}`,
  })
}

export function composeCommands(commands: readonly Command[]): CommandRegistry {
  const byName = new Map<string, Command>()
  const byInboxKind = new Map<string, Command>()
  for (const command of commands) {
    if (byName.has(command.spec.name)) {
      throw new Error(`duplicate command "${command.spec.name}"`)
    }
    byName.set(command.spec.name, command)
    if (command.spec.handledIn === 'pod') byInboxKind.set(command.inboxKind, command)
  }
  return Object.freeze({ all: Object.freeze([...commands]), byName, byInboxKind })
}

export function commandOf({
  registry,
  name,
}: {
  registry: CommandRegistry
  name: string
}): Command | undefined {
  return registry.byName.get(name)
}
