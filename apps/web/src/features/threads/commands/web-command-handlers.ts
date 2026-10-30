import {
  ECommand,
  ECommandEffect,
  RAN,
  UNSUPPORTED,
  instructionsOfArgument,
  NOTHING_SAID_YET,
  refused,
  scopeOfArgument,
  unknownScopeReason,
  type CommandEffect,
  type CommandHandlers,
} from '@dltech/atlas-core'
import {
  EClientRequest,
  type EClientRequest as ClientRequestOp,
} from '@dltech/atlas-client/channel'
import { compactionReplySchema, rotateReplySchema } from '@dltech/atlas-wire/web'

import { skillCountNotice } from './skill-specs'

export const NOT_CONNECTED = 'The sandbox is not connected'
export const NOTHING_TO_COMPACT = 'Nothing to compact'
export const NEW_HREF = '/threads/new'
export const SETTINGS_HREF = '/settings'

export type CommandDeps = {
  threadId: string
  request: (args: { op: ClientRequestOp; params: unknown }) => Promise<unknown> | null
  operationId: () => string
  openModelPicker: () => void
  openSearch: () => void
  openProcesses: () => void
  navigate: (href: string) => void
  wake: () => Promise<void>
  reloadSkills: () => Promise<number>
}

const ran = (notice: string): CommandEffect => ({ type: ECommandEffect.Ran, notice })

export function webCommandHandlers(deps: CommandDeps): CommandHandlers {
  const ask = (args: { op: ClientRequestOp; params: unknown }) => deps.request(args)

  return {
    [ECommand.Compact]: async ({ argumentText }) => {
      const scope = scopeOfArgument(argumentText)
      if (scope === null) return refused(unknownScopeReason(argumentText))
      const pending = ask({
        op: EClientRequest.CompactHistory,
        params: {
          threadId: deps.threadId,
          operationId: deps.operationId(),
          scope,
        },
      })
      if (pending === null) return refused(NOT_CONNECTED)
      const reply = compactionReplySchema.parse(await pending)
      if (reply.type === 'refused') return refused(reply.reason)
      if (reply.type === 'nothing') return ran(NOTHING_TO_COMPACT)
      return RAN
    },
    [ECommand.Rotate]: async ({ argumentText }) => {
      const instructions = instructionsOfArgument(argumentText)
      const pending = ask({
        op: EClientRequest.Rotate,
        params: {
          threadId: deps.threadId,
          operationId: deps.operationId(),
          ...(instructions === undefined ? {} : { instructions }),
        },
      })
      if (pending === null) return refused(NOT_CONNECTED)
      const reply = rotateReplySchema.parse(await pending)
      return reply.type === 'refused' ? refused(reply.reason) : ran('Rotating')
    },
    [ECommand.Rename]: async ({ argumentText }) => {
      const title = argumentText.trim()
      if (title === '') return refused(NOTHING_SAID_YET)
      const pending = ask({
        op: EClientRequest.RenameThread,
        params: { threadId: deps.threadId, title },
      })
      if (pending === null) return refused(NOT_CONNECTED)
      await pending
      return RAN
    },
    [ECommand.Model]: () => {
      deps.openModelPicker()
      return RAN
    },
    [ECommand.New]: () => {
      deps.navigate(NEW_HREF)
      return RAN
    },
    [ECommand.Resume]: () => {
      deps.openSearch()
      return RAN
    },
    [ECommand.Settings]: () => {
      deps.navigate(SETTINGS_HREF)
      return RAN
    },
    [ECommand.Shells]: () => {
      deps.openProcesses()
      return RAN
    },
    [ECommand.Wake]: async () => {
      await deps.wake()
      return RAN
    },
    [ECommand.Skills]: async () => {
      return ran(skillCountNotice(await deps.reloadSkills()))
    },
    [ECommand.Cd]: UNSUPPORTED,
    [ECommand.Container]: UNSUPPORTED,
    [ECommand.Help]: UNSUPPORTED,
    [ECommand.Auth]: UNSUPPORTED,
    [ECommand.Exit]: UNSUPPORTED,
    [ECommand.Restart]: UNSUPPORTED,
    [ECommand.Mcp]: UNSUPPORTED,
    [ECommand.Rewind]: UNSUPPORTED,
  }
}
