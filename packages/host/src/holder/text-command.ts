import {
  ECommandRunsIn,
  EInvocation,
  parseInvocation,
  type Command,
  type CommandHandler,
  type CommandRegistry,
  type ControlCommandHandler,
} from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import type { ConsumedCommand } from '@dltech/atlas-core'

export type CommandHandlers = ReadonlyMap<string, CommandHandler<unknown>>
export type ControlHandlers = ReadonlyMap<string, ControlCommandHandler<ControlPlane, unknown>>

export enum ETextPlan {
  Message = 'message',
  Command = 'command',
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
  | { kind: ETextPlan.Refused; reason: string }

export const clientOnlyReason = (name: string): string =>
  `/${name} opens in the app. Pick it from the / menu.`

export const noRunnerReason = (name: string): string => `This session cannot run /${name} yet.`

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

export const planTextInput = (input: {
  text: string
  commands: CommandRegistry
  handlers: CommandHandlers
  controlHandlers: ControlHandlers
}): TextPlan => {
  const invocation = parseInvocation({ text: input.text, commands: input.commands, skills: [] })
  if (invocation.kind === EInvocation.Message || invocation.kind === EInvocation.Skill) {
    return { kind: ETextPlan.Message }
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
