import { BadRequestException } from '@nestjs/common'
import {
  commandOf,
  composeCommands,
  type CommandRegistry,
  type ControlCommandHandler,
} from '@dltech/atlas-commands'
import { nativeCommands, nativeControlHandlers } from '@dltech/atlas-native-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import type { SessionCommandOutput } from '@dltech/atlas-protocol'
import { composedPlugins } from './registered-plugins'

export const COMMAND_REGISTRY = Symbol('COMMAND_REGISTRY')

export const nativeCommandRegistry = (): CommandRegistry =>
  composeCommands([...nativeCommands, ...composedPlugins.commands])

export const controlCommandHandlers = (): ReadonlyMap<
  string,
  ControlCommandHandler<ControlPlane, unknown>
> => new Map([...nativeControlHandlers, ...composedPlugins.control.commands])

export async function postCommand(params: {
  plane: ControlPlane
  registry: CommandRegistry
  sessionId: string
  name: string
  args: unknown
  controlHandlers?: ReadonlyMap<string, ControlCommandHandler<ControlPlane, unknown>>
}): Promise<SessionCommandOutput> {
  const command = commandOf({ registry: params.registry, name: params.name })
  if (command === undefined) throw new BadRequestException(`unknown command "${params.name}"`)
  const parsed = command.spec.args.safeParse(params.args)
  if (!parsed.success) {
    throw new BadRequestException(`invalid arguments for "${params.name}": ${parsed.error.message}`)
  }
  if (command.spec.handledIn === 'control') {
    const handlers = params.controlHandlers ?? nativeControlHandlers
    const handler = handlers.get(command.spec.name)
    if (handler === undefined) throw new Error(`no control handler for "${command.spec.name}"`)
    await handler({ plane: params.plane, sessionId: params.sessionId, args: parsed.data })
    return {}
  }
  return params.plane.post({
    sessionId: params.sessionId,
    kind: command.inboxKind,
    payload: JSON.stringify(parsed.data),
  })
}
