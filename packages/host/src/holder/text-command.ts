import {
  ECommandRunsIn,
  EInvocation,
  parseInvocation,
  type Command,
  type CommandHandler,
  type CommandRegistry,
  type ControlCommandHandler,
  type Invocation,
} from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import type { ConsumedCommand } from '@dltech/atlas-core'
import type { PodSlash } from '@dltech/atlas-plugin-sdk'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

export type CommandHandlers = ReadonlyMap<string, CommandHandler<unknown>>
export type ControlHandlers = ReadonlyMap<string, ControlCommandHandler<ControlPlane, unknown>>

export enum ETextPlan {
  Message = 'message',
  Command = 'command',
  Skill = 'skill',
  Refused = 'refused',
}

export type TextCommandRun =
  | { pod: CommandHandler<unknown> }
  | { control: ControlCommandHandler<ControlPlane, unknown> }

export type TextPlan =
  | { kind: ETextPlan.Message }
  | {
      kind: ETextPlan.Command
      command: Command
      run: TextCommandRun
      args: unknown
      consumed: ConsumedCommand
    }
  | { kind: ETextPlan.Skill; name: string; argumentText: string }
  | { kind: ETextPlan.Refused; reason: string }

export const clientOnlyReason = (name: string): string =>
  `/${name} opens in the app. Pick it from the / menu.`

export const noRunnerReason = (name: string): string => `This session cannot run /${name} yet.`

export type SkillNames = () => Promise<readonly string[]>

export const slashNamesOf = async (args: {
  slash?: PodSlash | undefined
  log?: LogPort | undefined
}): Promise<readonly string[]> => {
  if (args.slash === undefined) return []
  try {
    return await args.slash.names()
  } catch (error) {
    args.log?.warn({
      source: 'holder.command',
      message: 'reading the skill names failed, so the text stays a message',
      ...logFieldsOf({ error }),
    })
    return []
  }
}

const commandPlan = (args: {
  command: Command
  invocationArgs: unknown
  argumentText: string
  text: string
  handlers: CommandHandlers
  controlHandlers: ControlHandlers
}): TextPlan => {
  const { command } = args
  const { name, runsIn } = command.spec
  const consumed: ConsumedCommand = { name, argumentText: args.argumentText, text: args.text }
  if (runsIn === ECommandRunsIn.Client) {
    return { kind: ETextPlan.Refused, reason: clientOnlyReason(name) }
  }
  if (runsIn === ECommandRunsIn.Control) {
    const control = args.controlHandlers.get(name)
    if (control === undefined) return { kind: ETextPlan.Refused, reason: noRunnerReason(name) }
    return {
      kind: ETextPlan.Command,
      command,
      run: { control },
      args: args.invocationArgs,
      consumed,
    }
  }
  const pod = args.handlers.get(command.inboxKind)
  if (pod === undefined) return { kind: ETextPlan.Refused, reason: noRunnerReason(name) }
  return { kind: ETextPlan.Command, command, run: { pod }, args: args.invocationArgs, consumed }
}

export const lazySkillNamesOf = (args: {
  slash?: PodSlash | undefined
  log?: LogPort | undefined
}): SkillNames => {
  let names: Promise<readonly string[]> | undefined
  return () => {
    names ??= slashNamesOf(args)
    return names
  }
}

const invocationOf = async (input: {
  text: string
  commands: CommandRegistry
  skills: SkillNames
}): Promise<Invocation> => {
  const withoutSkills = parseInvocation({ text: input.text, commands: input.commands, skills: [] })
  if (withoutSkills.kind !== EInvocation.Message || !input.text.startsWith('/'))
    return withoutSkills
  return parseInvocation({
    text: input.text,
    commands: input.commands,
    skills: await input.skills(),
  })
}

export const planTextInput = async (input: {
  text: string
  commands: CommandRegistry
  handlers: CommandHandlers
  controlHandlers: ControlHandlers
  slash?: PodSlash | undefined
  skills?: SkillNames | undefined
  log?: LogPort | undefined
}): Promise<TextPlan> => {
  const invocation = await invocationOf({
    text: input.text,
    commands: input.commands,
    skills: input.skills ?? lazySkillNamesOf({ slash: input.slash, log: input.log }),
  })
  if (invocation.kind === EInvocation.Message) return { kind: ETextPlan.Message }
  if (invocation.kind === EInvocation.Skill) {
    return {
      kind: ETextPlan.Skill,
      name: invocation.name,
      argumentText: invocation.argumentText,
    }
  }
  if (invocation.kind === EInvocation.Refused) {
    return { kind: ETextPlan.Refused, reason: invocation.reason }
  }
  return commandPlan({
    command: invocation.command,
    invocationArgs: invocation.args,
    argumentText: invocation.argumentText,
    text: input.text,
    handlers: input.handlers,
    controlHandlers: input.controlHandlers,
  })
}

export const isTextCommand = (plan: TextPlan): boolean => plan.kind !== ETextPlan.Message
