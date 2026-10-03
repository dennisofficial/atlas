import { connect, type Socket } from 'node:net'

import { messageOf } from './identity'
import {
  EControlError,
  encodeFrame,
  FrameDecoder,
  REQUEST_TIMEOUT_MS,
  serverMessageSchema,
  type ClientRequest,
  type ControlResult,
  type ServerMessage,
} from './protocol'

export type Requester = {
  request: (args: { request: ClientRequest }) => Promise<ControlResult>
  close: () => void
}

type Session = { socket: Socket; pending: Map<number, (reply: ServerMessage) => void> }

const unreachable = (message: string): ControlResult => ({
  ok: false,
  code: EControlError.Unreachable,
  message,
})

export function createSocketRequester({
  socketPath,
  token,
  identity,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  socketPath: string
  token: string
  identity: string
  timeoutMs?: number
}): Requester {
  let session: Promise<Session | ControlResult> | undefined
  let liveSocket: Socket | undefined
  let nextId = 1
  let closed = false

  const open = (): Promise<Session | ControlResult> =>
    new Promise((resolve) => {
      const socket = connect(socketPath)
      liveSocket = socket
      const decoder = new FrameDecoder()
      const pending = new Map<number, (reply: ServerMessage) => void>()
      socket.setEncoding('utf8')

      const dropAll = (reason: string): void => {
        clearTimeout(deadline)
        if (liveSocket === socket) {
          liveSocket = undefined
          session = undefined
        }
        for (const [id, answer] of [...pending]) {
          answer({ type: 'error', id, code: EControlError.Unreachable, message: reason })
        }
        pending.clear()
        resolve(unreachable(reason))
      }
      const deadline = setTimeout(() => {
        resolve({ ok: false, code: EControlError.Timeout, message: 'no hello reply from the supervisor' })
        socket.destroy()
        dropAll('no hello reply from the supervisor')
      }, timeoutMs)
      socket.on('error', (error) => dropAll(messageOf({ error })))
      socket.on('close', () => dropAll('connection closed'))
      socket.on('data', (chunk: string) => {
        for (const frame of decoder.push({ chunk }).frames) {
          const parsed = serverMessageSchema.safeParse(frame)
          if (parsed.success) pending.get(parsed.data.id)?.(parsed.data)
        }
      })
      socket.on('connect', () => {
        const id = nextId++
        pending.set(id, (reply) => {
          pending.delete(id)
          if (reply.type === 'hello-ok' && reply.identity === identity) {
            clearTimeout(deadline)
            return resolve({ socket, pending })
          }
          socket.destroy()
          const code = reply.type === 'error' ? reply.code : EControlError.IdentityMismatch
          resolve({ ok: false, code, message: reply.type === 'error' ? reply.message : 'identity mismatch' })
        })
        socket.write(encodeFrame({ message: { type: 'hello', id, token, identity } }))
      })
    })

  return {
    request: async ({ request }) => {
      if (closed) return unreachable('requester closed')
      const attempt = (session ??= open())
      const opened = await attempt
      if (!('socket' in opened)) {
        if (session === attempt) session = undefined
        return opened
      }
      if (closed || opened.socket.destroyed) return unreachable('connection closed')
      const id = nextId++
      return new Promise<ControlResult>((resolve) => {
        const timer = setTimeout(() => {
          opened.pending.delete(id)
          resolve({ ok: false, code: EControlError.Timeout, message: 'no reply from the supervisor' })
        }, timeoutMs)
        opened.pending.set(id, (reply) => {
          clearTimeout(timer)
          opened.pending.delete(id)
          if (reply.type === 'error') resolve({ ok: false, code: reply.code, message: reply.message })
          else resolve({ ok: true })
        })
        opened.socket.write(encodeFrame({ message: { ...request, id } }))
      })
    },
    close: () => {
      closed = true
      session = undefined
      liveSocket?.destroy()
    },
  }
}
