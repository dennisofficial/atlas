import {
  jsonRpcMessageSchema,
  type JsonRpcMessage,
  type MacServerTransport,
} from '@dltech/atlas-protocol/mac-link'

import { errnoReason, type MacMcpChannel, type MacMcpChannelArgs } from './channel'

export const HTTP_TIMEOUT_MS = 30_000

export const HTTP_CLOSE_TIMEOUT_MS = 2_000

const eventDataOf = (text: string): unknown => {
  let last: unknown
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const data = trimmed.slice('data:'.length).trim()
    if (data === '') continue
    try {
      last = JSON.parse(data)
    } catch {
      last = undefined
    }
  }
  return last
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const openHttpChannel = (
  args: MacMcpChannelArgs & {
    transport: Extract<MacServerTransport, { kind: 'http' }>
    fetch?: typeof fetch
  },
): Promise<MacMcpChannel> => {
  const doFetch = args.fetch ?? fetch
  const url = args.transport.url
  let sessionId: string | undefined
  let closed = false
  let used = args.now()
  let firstPost = true
  let queue: Promise<void> = Promise.resolve()

  const headers = (): Record<string, string> => ({
    ...(args.transport.headers ?? {}),
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(sessionId === undefined ? {} : { 'mcp-session-id': sessionId }),
  })

  const finish = (reason: string): void => {
    if (closed) return
    closed = true
    args.emit({ type: 'closed', channelId: args.channelId, reason })
  }

  const accept = (value: unknown): void => {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      const message = jsonRpcMessageSchema.safeParse(item)
      if (!message.success) {
        args.log('dropped an inbound message that is not JSON-RPC')
        continue
      }
      used = args.now()
      args.emit({ type: 'rpc', channelId: args.channelId, message: message.data })
    }
  }

  const replyError = (message: JsonRpcMessage, reason: string): void => {
    if (message.id === undefined) return
    args.emit({
      type: 'rpc',
      channelId: args.channelId,
      message: { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: reason } },
    })
  }

  const post = async (message: JsonRpcMessage): Promise<void> => {
    used = args.now()
    const wasFirst = firstPost
    let response: Response
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
    } catch (error) {
      const reason = errnoReason(error)
      replyError(message, reason)
      if (wasFirst) finish(`unreachable: ${reason}`)
      return
    }
    firstPost = false
    const session = response.headers.get('mcp-session-id')
    if (session !== null && session !== '') sessionId = session
    if (!response.ok) {
      replyError(message, `answered ${response.status}`)
      return
    }
    try {
      const text = await response.text()
      if (text.trim() === '') return
      const type = response.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream')) {
        const event = eventDataOf(text)
        if (event !== undefined) accept(event)
        return
      }
      accept(parseJson(text))
    } catch (error) {
      args.log(`dropped an unreadable body: ${errnoReason(error)}`)
    }
  }

  const send = (message: JsonRpcMessage): void => {
    if (closed) return
    queue = queue
      .then(() => post(message))
      .catch((error: unknown) => {
        args.log(`dropped an outbound message: ${errnoReason(error)}`)
      })
  }

  const deleteSession = async (): Promise<void> => {
    const session = sessionId
    sessionId = undefined
    if (session === undefined) return
    try {
      await doFetch(url, {
        method: 'DELETE',
        headers: { ...(args.transport.headers ?? {}), 'mcp-session-id': session },
        signal: AbortSignal.timeout(HTTP_CLOSE_TIMEOUT_MS),
      })
    } catch {
      return
    }
  }

  const close = (reason: string): void => {
    void deleteSession()
    finish(reason)
  }

  return Promise.resolve({ send, close, lastUsedAt: () => used })
}
