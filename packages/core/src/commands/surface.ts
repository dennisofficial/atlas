import {
  COMMAND_CATALOGUE,
  COMMAND_ORDER,
  type CommandDefinition,
  type ECommand,
} from './catalogue'
import type { CommandEffect, ECommandTiming } from './effect'
import { resolveSubmission } from './resolve'
import type { CommandSpec } from './spec'

export const UNSUPPORTED = Symbol('unsupported')

export type CommandRun = (args: { argumentText: string }) => CommandEffect | Promise<CommandEffect>

export type CommandHandler = CommandRun | { run: CommandRun; timing?: ECommandTiming }

export type CommandHandlers = Readonly<Record<ECommand, CommandHandler | typeof UNSUPPORTED>>

export type SurfaceCommand = CommandDefinition & { run: CommandRun }

export function surfaceCommands(args: { handlers: CommandHandlers }): readonly SurfaceCommand[] {
  const commands: SurfaceCommand[] = []

  for (const command of COMMAND_ORDER) {
    const handler = args.handlers[command]
    if (handler === UNSUPPORTED) continue

    const definition = COMMAND_CATALOGUE[command]
    if (typeof handler === 'function') {
      commands.push({ ...definition, run: handler })
      continue
    }

    commands.push({
      ...definition,
      timing: handler.timing ?? definition.timing,
      run: handler.run,
    })
  }

  return commands
}

export function unsupportedCommand(args: {
  text: string
  handlers: CommandHandlers
  skills: readonly CommandSpec[]
}): CommandDefinition | null {
  const { local } = resolveSubmission({
    text: args.text,
    specs: [...COMMAND_ORDER.map((command) => COMMAND_CATALOGUE[command]), ...args.skills],
  })
  if (local === null) return null

  const found = COMMAND_ORDER.find((command) => command === local.spec.name)
  if (found === undefined) return null

  return args.handlers[found] === UNSUPPORTED ? COMMAND_CATALOGUE[found] : null
}
