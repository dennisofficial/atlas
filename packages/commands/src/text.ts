import { slashNameOf } from './mention'
import type { Command, CommandRegistry } from './registry'

export enum EInvocation {
  Message = 'message',
  Command = 'command',
  Skill = 'skill',
  Refused = 'refused',
}

export type Invocation =
  | { kind: EInvocation.Message }
  | { kind: EInvocation.Command; command: Command; args: unknown; argumentText: string }
  | { kind: EInvocation.Skill; name: string; argumentText: string }
  | { kind: EInvocation.Refused; name: string; reason: string }

const firstLineOf = (text: string): string => text.split('\n')[0] ?? ''

const refused = ({ name, reason }: { name: string; reason: string }): Invocation => ({
  kind: EInvocation.Refused,
  name,
  reason,
})

const commandInvocation = ({
  command,
  argumentText,
}: {
  command: Command
  argumentText: string
}): Invocation => {
  const spec = command.spec
  if (spec.fromText === undefined) {
    if (argumentText !== '') {
      return refused({ name: spec.name, reason: `/${spec.name} takes no arguments` })
    }
    return parsedInvocation({ command, args: {}, argumentText })
  }
  const textArgs = spec.fromText(argumentText)
  if (!textArgs.ok) return refused({ name: spec.name, reason: textArgs.reason })
  return parsedInvocation({ command, args: textArgs.args, argumentText })
}

const parsedInvocation = ({
  command,
  args,
  argumentText,
}: {
  command: Command
  args: unknown
  argumentText: string
}): Invocation => {
  const parsed = command.spec.args.safeParse(args)
  if (!parsed.success) {
    return refused({
      name: command.spec.name,
      reason: `The arguments for /${command.spec.name} are not valid`,
    })
  }
  return { kind: EInvocation.Command, command, args: parsed.data, argumentText }
}

export const parseInvocation = ({
  text,
  commands,
  skills,
}: {
  text: string
  commands: CommandRegistry
  skills: readonly string[]
}): Invocation => {
  const found = slashNameOf({ text: firstLineOf(text) })
  if (found === null) return { kind: EInvocation.Message }

  const argumentText = text.slice(found.end).trim()
  const command = commands.byName.get(found.name)
  if (command !== undefined) return commandInvocation({ command, argumentText })
  if (skills.includes(found.name))
    return { kind: EInvocation.Skill, name: found.name, argumentText }
  return { kind: EInvocation.Message }
}
