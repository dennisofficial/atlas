import { BadRequestException } from '@nestjs/common'
import { commandOf, composeCommands, type CommandRegistry } from '@dltech/atlas-commands'
import type { ControlPlane } from '@dltech/atlas-control'
import type { SessionCommandOutput } from '@dltech/atlas-protocol'

export const COMMAND_REGISTRY = Symbol('COMMAND_REGISTRY')

export const nativeCommandRegistry = (): CommandRegistry => composeCommands([])

export async function postCommand(params: {
  plane: ControlPlane
  registry: CommandRegistry
  sessionId: string
  name: string
  args: unknown
}): Promise<SessionCommandOutput> {
  const command = commandOf({ registry: params.registry, name: params.name })
  if (command === undefined) throw new BadRequestException(`unknown command "${params.name}"`)
  const parsed = command.spec.args.safeParse(params.args)
  if (!parsed.success) {
    throw new BadRequestException(`invalid arguments for "${params.name}": ${parsed.error.message}`)
  }
  return params.plane.post({
    sessionId: params.sessionId,
    kind: command.inboxKind,
    payload: JSON.stringify(parsed.data),
  })
}
