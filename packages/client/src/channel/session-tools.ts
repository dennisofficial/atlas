import {
  pendingEditReplySchema,
  readGitChangesReplySchema,
  terminalAckReplySchema,
  terminalOpenReplySchema,
  type EChangeScope,
  type PendingEditReply,
  type ReadGitChangesReply,
  type TerminalExitWire,
  type TerminalOutputWire,
} from '@dltech/atlas-wire/web'

import { EClientRequest } from './channel-wire'
import type { Unsubscribe } from './delta-channel-types'
import type { RemoteDeltaChannel, TerminalFrameChannel } from './remote-delta-channel-types'

type RequestChannel = Pick<RemoteDeltaChannel, 'request'>

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
