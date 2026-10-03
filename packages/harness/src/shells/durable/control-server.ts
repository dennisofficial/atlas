import { createServer, type Server, type Socket } from 'node:net'

import { tokensMatch } from './identity'
import {
  clientMessageSchema,
  EControlError,
  encodeFrame,
  FrameDecoder,
  HELLO_TIMEOUT_MS,
  INPUT_FRAME_BYTES,
  MAX_CONNECTIONS,
  type ClientMessage,
  type ControlResult,
  type EShellSignal,
  type ProcessStamp,
  type ServerMessage,
} from './protocol'

export type ShellActions = {
  touch: () => void
  input: (args: { data: Buffer }) => Promise<ControlResult>
  closeInput: () => ControlResult
  signal: (args: { signal: EShellSignal }) => ControlResult
  terminate: () => ControlResult
  kill: () => ControlResult
}

export type ControlServerArgs = {
  identity: string
  token: string
  supervisor: ProcessStamp
  child: ProcessStamp
  leaseMs: number
  actions: ShellActions
}

function send({ socket, message }: { socket: Socket; message: ServerMessage }): void {
  if (!socket.destroyed) socket.write(encodeFrame({ message }))
}

function fail({
  socket,
  id,
  code,
  message,
}: {
  socket: Socket
  id: number
  code: EControlError
  message: string
}): void {
  send({ socket, message: { type: 'error', id, code, message } })
}

async function dispatch({
  message,
  actions,
}: {
  message: ClientMessage
  actions: ShellActions
}): Promise<ControlResult> {
  switch (message.type) {
    case 'input':
      return await actions.input({ data: Buffer.from(message.dataBase64, 'base64') })
    case 'closeInput':
      return actions.closeInput()
    case 'signal':
      return actions.signal({ signal: message.signal })
    case 'terminate':
      return actions.terminate()
    case 'kill':
      return actions.kill()
    case 'heartbeat':
    case 'hello':
      return { ok: true }
  }
}

function handleConnection({ socket, args }: { socket: Socket; args: ControlServerArgs }): void {
  const decoder = new FrameDecoder()
  let authenticated = false
  socket.setEncoding('utf8')
  socket.on('error', () => socket.destroy())
  const helloTimer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS)
  socket.on('close', () => clearTimeout(helloTimer))

  let queue: Promise<void> = Promise.resolve()

  const handleMessage = async (message: ClientMessage): Promise<void> => {
    if (!authenticated) {
      const accepted =
        message.type === 'hello' &&
        message.identity === args.identity &&
        tokensMatch({ expected: args.token, presented: message.token })
      if (!accepted) {
        fail({ socket, id: message.id, code: EControlError.Unauthorized, message: 'hello rejected' })
        socket.end()
        return
      }
      authenticated = true
      clearTimeout(helloTimer)
      args.actions.touch()
      send({
        socket,
        message: {
          type: 'hello-ok',
          id: message.id,
          identity: args.identity,
          supervisor: args.supervisor,
          child: args.child,
          leaseMs: args.leaseMs,
        },
      })
      return
    }
    args.actions.touch()
    const result = await dispatch({ message, actions: args.actions })
    if (result.ok) send({ socket, message: { type: 'ack', id: message.id } })
    else fail({ socket, id: message.id, code: result.code, message: result.message })
  }

  socket.on('data', (chunk: string) => {
    const decoded = decoder.push({ chunk })
    for (const frame of decoded.frames) {
      const parsed = clientMessageSchema.safeParse(frame)
      if (!parsed.success) {
        fail({ socket, id: 0, code: EControlError.InvalidMessage, message: 'unrecognised message' })
        socket.destroy()
        return
      }
      const message = parsed.data
      queue = queue.then(() => handleMessage(message)).catch((): void => {
        socket.destroy()
      })
    }
    if (decoded.error !== undefined) {
      fail({ socket, id: 0, code: EControlError.InvalidMessage, message: decoded.error })
      socket.destroy()
    }
  })
}

export type ControlServer = {
  listen: (args: { path: string }) => Promise<void>
  close: () => Promise<void>
}

export function createControlServer(args: ControlServerArgs): ControlServer {
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    handleConnection({ socket, args })
  })
  server.maxConnections = MAX_CONNECTIONS

  return {
    listen: ({ path }) =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(path, () => resolve())
      }),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
