import type { ApiClient } from '@dltech/atlas-api-router'
import { detailsOf, httpStatusOf } from '@dltech/atlas-api-router'
import {
  createRemoteDeltaChannel,
  EClientRequest,
  EConnectionView,
  type ChannelSignal,
  type ConnectionView,
  type SandboxAttachment,
} from '@dltech/atlas-client/channel'
import { toThreadId, type Attachment } from '@dltech/atlas-core'
import { operatorInputReplySchema } from '@dltech/atlas-wire/web'

const CONFLICT = 409
const POD_NOT_RUNNING = 'pod-not-running'
const MAX_RECONNECTS = 4
const RECONNECT_BASE_MS = 1000

export const NOT_CONNECTED = "Atlas isn't connected to this session right now."

const ticketOf = async (args: {
  api: ApiClient
  threadId: string
}): Promise<SandboxAttachment | null> => {
  try {
    const reply = await args.api.threadPod.connect.mutate({ threadId: args.threadId })
    return { url: reply.url, token: reply.token }
  } catch (failure) {
    if (httpStatusOf(failure) === CONFLICT && detailsOf(failure)?.code === POD_NOT_RUNNING)
      return null
    throw failure
  }
}

export type ThreadChannelHandlers = {
  onSignal: (signal: ChannelSignal) => void
  onConnection: (connection: ConnectionView) => void
  onReload: () => void
  onRenamed: (title: string) => void
}

export type ThreadChannel = {
  connected: () => boolean
  send: (args: { text: string; requestId: string; attachments: readonly Attachment[] }) => boolean
  interrupt: () => boolean
  retry: () => boolean
  provideOperatorInput: (args: { requestId: string; value: string }) => Promise<string | null>
  close: () => void
}

export async function openThreadChannel(args: {
  api: ApiClient
  threadId: string
  headSeq: () => number
  handlers: ThreadChannelHandlers
}): Promise<ThreadChannel | null> {
  const ticket = await ticketOf({ api: args.api, threadId: args.threadId })
  if (ticket === null) return null

  const threadId = toThreadId(args.threadId)
  let connection: ConnectionView = { state: EConnectionView.Reconnecting, detail: null }
  let retries = 0
  let closed = false

  const channel = createRemoteDeltaChannel({
    threadId,
    url: ticket.url,
    token: ticket.token,
    lastEventSeq: args.headSeq,
    maxAttempts: 0,
    wakeSandbox: async () => {
      const next = await ticketOf({ api: args.api, threadId: args.threadId })
      if (next === null) throw new Error('The sandbox is not running.')
      return next
    },
  })

  const reconnect = () => {
    if (closed || retries >= MAX_RECONNECTS) return
    const delayMs = RECONNECT_BASE_MS * 2 ** retries
    retries += 1
    setTimeout(() => {
      if (!closed) channel.reconnect()
    }, delayMs)
  }

  channel.subscribe({ threadId, listener: args.handlers.onSignal })
  channel.onConnection((next) => {
    connection = next
    if (next.state === EConnectionView.Connected) retries = 0
    if (next.state === EConnectionView.Disconnected) reconnect()
    args.handlers.onConnection(next)
  })
  channel.onReload(() => args.handlers.onReload())
  channel.onThreadRenamed((renamed) => {
    if (renamed.threadId === threadId) args.handlers.onRenamed(renamed.title)
  })

  const isConnected = (): boolean => connection.state === EConnectionView.Connected

  return {
    connected: isConnected,
    send: ({ text, requestId, attachments }) => {
      if (!isConnected()) return false
      channel.send({ text, requestId, attachments })
      return true
    },
    interrupt: () => {
      if (!isConnected()) return false
      channel.interrupt()
      return true
    },
    retry: () => {
      if (!isConnected()) return false
      channel.run()
      return true
    },
    provideOperatorInput: async ({ requestId, value }) => {
      if (!isConnected()) return NOT_CONNECTED
      try {
        const reply = operatorInputReplySchema.parse(
          await channel.request({
            op: EClientRequest.ProvideOperatorInput,
            params: { requestId, value },
          }),
        )
        return reply.delivered ? null : "Atlas couldn't take that. Try again."
      } catch (failure) {
        return failure instanceof Error ? failure.message : String(failure)
      }
    },
    close: () => {
      closed = true
      channel.close()
    },
  }
}
