import type { ThreadId } from '@dltech/atlas-core'

import { EClientFrame, type ClientFrame, type EClientRequest, encodeFrame } from './channel-wire'

export class RemotePublishRefused extends Error {
  constructor(threadId: ThreadId) {
    super(
      `Thread ${threadId} runs in a cloud sandbox, which owns its channel: a client cannot publish into it.`,
    )
    this.name = 'RemotePublishRefused'
  }
}

const detailOf = (data: unknown): string => {
  if (typeof data === 'string' && data.length > 0) return `: ${data}`
  if (typeof data !== 'object' || data === null) return ''

  const message = Reflect.get(data, 'message')
  return typeof message === 'string' && message.length > 0 ? `: ${message}` : ''
}

export class RemoteRequestFailed extends Error {
  readonly op: EClientRequest
  readonly data: unknown

  constructor(args: { op: EClientRequest; data: unknown }) {
    super(`The sandbox refused the ${args.op} request${detailOf(args.data)}.`)
    this.name = 'RemoteRequestFailed'
    this.op = args.op
    this.data = args.data
  }
}

export class RemoteRequestLost extends Error {
  readonly op: EClientRequest

  constructor(args: { op: EClientRequest; reason: string }) {
    super(`The ${args.op} request was never answered: ${args.reason}.`)
    this.name = 'RemoteRequestLost'
    this.op = args.op
  }
}

export type UpstreamPipe = {
  send(frame: ClientFrame): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  settleReply(args: { replyTo: string; ok: boolean; data: unknown }): void
  attach(args: { write: (data: string) => boolean }): void
  detach(args: { reason: string }): void
}

type Waiting = {
  op: EClientRequest
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function createUpstreamPipe(args: {
  timeoutMs: number
  scheduleTimeout: (timeout: { delayMs: number; run: () => void }) => void
}): UpstreamPipe {
  const waiting = new Map<string, Waiting>()
  const queued: ClientFrame[] = []
  let write: ((data: string) => boolean) | null = null
  let issued = 0

  const emit = (frame: ClientFrame) => {
    if (write === null) {
      queued.push(frame)
      return
    }
    if (!write(encodeFrame(frame))) queued.push(frame)
  }

  const claim = (id: string): Waiting | undefined => {
    const claimed = waiting.get(id)
    waiting.delete(id)
    return claimed
  }

  return {
    send: emit,

    request({ op, params }) {
      issued += 1
      const id = `req-${issued}`

      return new Promise<unknown>((resolve, reject) => {
        waiting.set(id, { op, resolve, reject })
        emit({ kind: EClientFrame.Request, id, op, params })
        args.scheduleTimeout({
          delayMs: args.timeoutMs,
          run: () =>
            claim(id)?.reject(
              new RemoteRequestLost({ op, reason: `it timed out after ${args.timeoutMs}ms` }),
            ),
        })
      })
    },

    settleReply({ replyTo, ok, data }) {
      const claimed = claim(replyTo)
      if (claimed === undefined) return

      if (ok) claimed.resolve(data)
      else claimed.reject(new RemoteRequestFailed({ op: claimed.op, data }))
    },

    attach({ write: writer }) {
      write = writer
      for (const frame of queued.splice(0, queued.length)) {
        if (!writer(encodeFrame(frame))) queued.push(frame)
      }
    },

    detach({ reason }) {
      write = null

      for (const [id, claimed] of [...waiting]) {
        waiting.delete(id)
        claimed.reject(new RemoteRequestLost({ op: claimed.op, reason }))
      }

      const kept = queued.filter((frame) => frame.kind !== EClientFrame.Request)
      queued.splice(0, queued.length, ...kept)
    },
  }
}
