import {
  killShellReplySchema,
  pendingEditReplySchema,
  readGitChangesReplySchema,
  serviceLogReplySchema,
  shellOutputReplySchema,
  startedShellReplySchema,
  stopServiceReplySchema,
  terminalAckReplySchema,
  terminalOpenReplySchema,
  type EChangeScope,
  type KillShellReply,
  type PendingEditReply,
  type ReadGitChangesReply,
  type ShellOutputReply,
  type StartedShellReply,
  type StopServiceReply,
  type TerminalExitWire,
  type TerminalOutputWire,
} from '@dltech/atlas-wire/web'

import { EClientRequest } from './channel-wire'
import type { Unsubscribe } from './delta-channel-types'
import { RemoteRequestFailed } from './remote-channel-upstream'
import type { RemoteDeltaChannel, TerminalFrameChannel } from './remote-delta-channel-types'

export type RequestChannel = Pick<RemoteDeltaChannel, 'request'>

export const readGitChanges = async (args: {
  channel: RequestChannel
  scope: EChangeScope
}): Promise<ReadGitChangesReply> =>
  readGitChangesReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.ReadGitChanges,
      params: { scope: args.scope },
    }),
  )

export const updatePendingEntry = async (args: {
  channel: RequestChannel
  threadId: string
  id: string
  text: string
}): Promise<PendingEditReply> =>
  pendingEditReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.UpdatePending,
      params: { threadId: args.threadId, id: args.id, text: args.text },
    }),
  )

export const removePendingEntry = async (args: {
  channel: RequestChannel
  threadId: string
  id: string
}): Promise<PendingEditReply> =>
  pendingEditReplySchema.parse(
    await args.channel.request({
      op: EClientRequest.RemovePending,
      params: { threadId: args.threadId, id: args.id },
    }),
  )

const refusedOr = async <T>(args: {
  request: () => Promise<T>
  refused: (reason: string) => T
}): Promise<T> => {
  try {
    return await args.request()
  } catch (error) {
    if (error instanceof RemoteRequestFailed) return args.refused(error.message)
    throw error
  }
}

const refusal = (reason: string) => ({ ok: false as const, reason })

export const startShell = (args: {
  channel: RequestChannel
  threadId: string
  command: string
  description: string
  cwd?: string | undefined
}): Promise<StartedShellReply> =>
  refusedOr({
    request: async () =>
      startedShellReplySchema.parse(
        await args.channel.request({
          op: EClientRequest.StartShell,
          params: {
            threadId: args.threadId,
            command: args.command,
            description: args.description,
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          },
        }),
      ),
    refused: refusal,
  })

export const readShellOutput = (args: {
  channel: RequestChannel
  threadId: string
  shellId: string
  characters: number
}): Promise<ShellOutputReply> =>
  refusedOr({
    request: async () =>
      shellOutputReplySchema.parse(
        await args.channel.request({
          op: EClientRequest.ReadShellOutput,
          params: { threadId: args.threadId, shellId: args.shellId, characters: args.characters },
        }),
      ),
    refused: refusal,
  })

export const killShell = (args: {
  channel: RequestChannel
  threadId: string
  shellId: string
}): Promise<KillShellReply> =>
  refusedOr({
    request: async () =>
      killShellReplySchema.parse(
        await args.channel.request({
          op: EClientRequest.KillShell,
          params: { threadId: args.threadId, shellId: args.shellId },
        }),
      ),
    refused: refusal,
  })

export const stopService = (args: {
  channel: RequestChannel
  serviceId: string
}): Promise<StopServiceReply> =>
  refusedOr({
    request: async () =>
      stopServiceReplySchema.parse(
        await args.channel.request({
          op: EClientRequest.StopService,
          params: { serviceId: args.serviceId },
        }),
      ),
    refused: refusal,
  })

export const readServiceLog = (args: {
  channel: RequestChannel
  serviceId: string
  characters: number
}): Promise<string> =>
  refusedOr({
    request: async () =>
      serviceLogReplySchema.parse(
        await args.channel.request({
          op: EClientRequest.ReadServiceLog,
          params: { serviceId: args.serviceId, characters: args.characters },
        }),
      ).text,
    refused: () => '',
  })

export type TerminalSession = {
  readonly terminalId: string
  write(data: string): Promise<boolean>
  resize(size: { cols: number; rows: number }): Promise<boolean>
  close(): Promise<boolean>
  onOutput(listener: (data: string) => void): Unsubscribe
  onExit(listener: (exit: TerminalExitWire) => void): Unsubscribe
}

type TerminalChannel = Pick<RemoteDeltaChannel, 'request'> & TerminalFrameChannel

const acknowledged = async (args: {
  channel: RequestChannel
  op: EClientRequest
  params: unknown
}): Promise<boolean> =>
  terminalAckReplySchema.parse(await args.channel.request({ op: args.op, params: args.params }))
    .done

export const openTerminal = async (args: {
  channel: TerminalChannel
  cols: number
  rows: number
}): Promise<TerminalSession> => {
  const { channel } = args
  const { terminalId } = terminalOpenReplySchema.parse(
    await channel.request({
      op: EClientRequest.TerminalOpen,
      params: { cols: args.cols, rows: args.rows },
    }),
  )
  const mine =
    <T extends { terminalId: string }>(listener: (value: T) => void) =>
    (value: T): void => {
      if (value.terminalId === terminalId) listener(value)
    }

  return {
    terminalId,
    write: (data) =>
      acknowledged({ channel, op: EClientRequest.TerminalWrite, params: { terminalId, data } }),
    resize: ({ cols, rows }) =>
      acknowledged({
        channel,
        op: EClientRequest.TerminalResize,
        params: { terminalId, cols, rows },
      }),
    close: () =>
      acknowledged({ channel, op: EClientRequest.TerminalClose, params: { terminalId } }),
    onOutput: (listener) =>
      channel.onTerminalOutput(mine((output: TerminalOutputWire) => listener(output.data))),
    onExit: (listener) => channel.onTerminalExit(mine(listener)),
  }
}
