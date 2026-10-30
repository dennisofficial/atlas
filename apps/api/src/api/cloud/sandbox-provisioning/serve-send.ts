import {
  bearerSubprotocolOf,
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  clientFrameSchema,
  decodeServeFrame,
  EClientFrame,
  encodeFrame,
  EServeFrame,
  type SaidImageWire,
  type SaidUploadWire,
} from '@dltech/atlas-wire'

export const SERVE_SEND = Symbol('SERVE_SEND')

const SERVE_SEND_TIMEOUT_MS = 15_000
const SESSION_PATH = '/v1/session'

export type ServeSendArgs = {
  url: string
  token: string
  threadId: string
  sendId: string
  text: string
  images?: readonly SaidImageWire[] | undefined
  uploads?: readonly SaidUploadWire[] | undefined
}

export type ServeSend = (args: ServeSendArgs) => Promise<void>

export type ServeSocket = { send(data: string): void; close(): void }

export type ServeSocketHandlers = {
  handleOpen(): void
  handleMessage(raw: string): void
  handleEnd(): void
}

export type OpenServeSocket = (args: {
  url: string
  protocols: string[]
  handlers: ServeSocketHandlers
}) => ServeSocket

const openWebSocket: OpenServeSocket = ({ url, protocols, handlers }) => {
  const socket = new WebSocket(url, protocols)
  socket.onopen = () => handlers.handleOpen()
  socket.onmessage = (event) => {
    if (typeof event.data === 'string') handlers.handleMessage(event.data)
  }
  socket.onerror = () => handlers.handleEnd()
  socket.onclose = () => handlers.handleEnd()
  return socket
}

const sessionSocketUrlOf = (url: string): string =>
  `${url.replace(/\/+$/, '').replace(/^http/, 'ws')}${SESSION_PATH}`

export class ServeProtocolRefusedError extends Error {}

// Released serves refuse a mismatched hello with prose naming the "wire protocol"
// (apps/serve/src/hello-admission.ts); older serves already in sandboxes cannot learn a code.
const serveRefusalOf = (message: string): Error =>
  /wire protocol/i.test(message) ? new ServeProtocolRefusedError(message) : new Error(message)

const errorOf = (failure: unknown): Error =>
  failure instanceof Error ? failure : new Error(String(failure))

export function deliverToServe(
  args: ServeSendArgs & { timeoutMs?: number; openSocket?: OpenServeSocket },
): Promise<void> {
  const open = args.openSocket ?? openWebSocket
  return new Promise<void>((resolve, reject) => {
    const hello = clientFrameSchema.parse({
      kind: EClientFrame.Hello,
      threadId: args.threadId,
      channelCursor: null,
      lastEventSeq: 0,
      protocol: CHANNEL_PROTOCOL_VERSION,
    })
    const send = clientFrameSchema.parse({
      kind: EClientFrame.Send,
      sendId: args.sendId,
      text: args.text,
      ...(args.images === undefined || args.images.length === 0 ? {} : { images: args.images }),
      ...(args.uploads === undefined || args.uploads.length === 0 ? {} : { uploads: args.uploads }),
    })
    let settled = false
    let socket: ServeSocket | undefined
    const timer = setTimeout(
      () => finish(new Error('serve did not acknowledge the message in time')),
      args.timeoutMs ?? SERVE_SEND_TIMEOUT_MS,
    )

    function finish(failure?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.close()
      if (failure === undefined) resolve()
      else reject(failure)
    }

    try {
      socket = open({
        url: sessionSocketUrlOf(args.url),
        protocols: [CHANNEL_SUBPROTOCOL, bearerSubprotocolOf(args.token)],
        handlers: {
          handleOpen: () => {
            socket?.send(encodeFrame(hello))
            socket?.send(encodeFrame(send))
          },
          handleMessage: (raw) => {
            const frame = decodeServeFrame(raw)
            if (frame === null) return
            if (frame.kind === EServeFrame.Error) finish(serveRefusalOf(frame.message))
            if (frame.kind === EServeFrame.SendAcked && frame.sendId === args.sendId) finish()
          },
          handleEnd: () =>
            finish(new Error('serve closed the connection before acknowledging the message')),
        },
      })
    } catch (failure) {
      finish(errorOf(failure))
    }
  })
}
