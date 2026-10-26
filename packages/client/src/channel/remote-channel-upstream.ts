import type { ThreadId } from '@dltech/atlas-core'

import { EClientFrame, EClientRequest, type ClientFrame, encodeFrame } from './channel-wire'
import { requestTimeoutFor } from './request-timeout'

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

const SAFE_TO_REDRIVE: ReadonlySet<EClientRequest> = new Set([
  EClientRequest.CompletePaths,
  EClientRequest.BrowseDirectory,
  EClientRequest.ListRoster,
  EClientRequest.ReadEvents,
  EClientRequest.ReadThread,
  EClientRequest.ReadThreads,
  EClientRequest.ReadTurns,
  EClientRequest.ReadTranscriptIdentity,
  EClientRequest.ListContextFiles,
  EClientRequest.ReadContextFile,
  EClientRequest.ListMentionFiles,
  EClientRequest.MentionFileExists,
  EClientRequest.ReadMentionFile,
  EClientRequest.ListPrStates,
  EClientRequest.ReadGitChanges,
])

type SendFrame = Extract<ClientFrame, { kind: EClientFrame.Send }>

/**
 * A backstop, not a deadline: a queued request whose wake fell through is rejected by
 * `failWaiting` the moment the failure is known, so this only bounds a wake that never
 * resolves. It clears the slowest legitimate wake (a serve swap that waits out a drain
 * behind a ten-minute tool call, then installs and boots) rather than tuning for the common case.
 */
export const UNWRITTEN_REQUEST_TIMEOUT_MS = 25 * 60 * 1000

export type UpstreamPipe = {
  send(frame: ClientFrame): void
  request(args: { op: EClientRequest; params: unknown }): Promise<unknown>
  settleReply(args: { replyTo: string; ok: boolean; data: unknown }): void
  ackSend(args: { sendId: SendFrame['sendId'] }): void
  attach(args: { write: (data: string) => boolean }): void
  detach(args: { reason: string }): void
  abandon(args: { reason: string }): void
  /**
   * Rejects every outstanding request, unlike detach, which keeps redrivable reads for the next
   * socket. Queued Sends and unacked ones stay, so they re-drive once a socket greets again.
   */
  failWaiting(args: { reason: string }): void
  unackedSendCount(): number
}

type Waiting = {
  op: EClientRequest
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export function createUpstreamPipe(args: {
  timeoutMs?: number | undefined
  unwrittenTimeoutMs?: number | undefined
  scheduleTimeout: (timeout: { delayMs: number; run: () => void }) => void
}): UpstreamPipe {
  const waiting = new Map<string, Waiting>()
  const queued: ClientFrame[] = []
  const redrivable = new Map<string, Extract<ClientFrame, { kind: EClientFrame.Request }>>()
  const pendingAcks = new Map<SendFrame['sendId'], SendFrame>()
  const unwritten = new Set<string>()
  let write: ((data: string) => boolean) | null = null
  let issued = 0

  const claim = (id: string): Waiting | undefined => {
    const claimed = waiting.get(id)
    waiting.delete(id)
    return claimed
  }

  /**
   * The answer deadline measures the serve, not the queue: a request parked behind a wake has
   * no clock until its frame first reaches a socket — but once armed, the deadline survives
   * detaches and re-drives, so a request can still time out mid-reconnect.
   */
  const armAnswerDeadline = (frame: Extract<ClientFrame, { kind: EClientFrame.Request }>) => {
    if (!unwritten.delete(frame.id)) return
    const timeoutMs = requestTimeoutFor({ op: frame.op, overrideMs: args.timeoutMs })
    args.scheduleTimeout({
      delayMs: timeoutMs,
      run: () =>
        claim(frame.id)?.reject(
          new RemoteRequestLost({ op: frame.op, reason: `it timed out after ${timeoutMs}ms` }),
        ),
    })
  }

  const emitted = (frame: ClientFrame) => {
    if (frame.kind === EClientFrame.Request) armAnswerDeadline(frame)
  }

  const emit = (frame: ClientFrame) => {
    if (write === null) {
      queued.push(frame)
      return
    }
    if (!write(encodeFrame(frame))) {
      queued.push(frame)
      return
    }
    emitted(frame)
  }

  const dropQueued = (id: string) => {
    for (let i = queued.length - 1; i >= 0; i--) {
      const frame = queued[i]
      if (frame !== undefined && frame.kind === EClientFrame.Request && frame.id === id) {
        queued.splice(i, 1)
      }
    }
  }

  return {
    send(frame) {
      if (frame.kind === EClientFrame.Send) pendingAcks.set(frame.sendId, frame)
      emit(frame)
    },

    request({ op, params }) {
      issued += 1
      const id = `req-${issued}`

      return new Promise<unknown>((resolve, reject) => {
        waiting.set(id, { op, resolve, reject })
        const frame = { kind: EClientFrame.Request, id, op, params } as const
        if (SAFE_TO_REDRIVE.has(op)) redrivable.set(id, frame)
        unwritten.add(id)
        emit(frame)
        if (!unwritten.has(id)) return
        const stallMs = args.unwrittenTimeoutMs ?? UNWRITTEN_REQUEST_TIMEOUT_MS
        args.scheduleTimeout({
          delayMs: stallMs,
          run: () => {
            if (!unwritten.delete(id)) return
            redrivable.delete(id)
            dropQueued(id)
            claim(id)?.reject(
              new RemoteRequestLost({
                op,
                reason: `it was never sent — the socket stayed closed for ${stallMs}ms`,
              }),
            )
          },
        })
      })
    },

    settleReply({ replyTo, ok, data }) {
      const claimed = claim(replyTo)
      if (claimed === undefined) return

      redrivable.delete(replyTo)
      if (ok) claimed.resolve(data)
      else claimed.reject(new RemoteRequestFailed({ op: claimed.op, data }))
    },

    ackSend({ sendId }) {
      pendingAcks.delete(sendId)
    },

    abandon({ reason }) {
      write = null
      redrivable.clear()
      pendingAcks.clear()
      queued.splice(0, queued.length)
      unwritten.clear()

      for (const [id, claimed] of [...waiting]) {
        waiting.delete(id)
        claimed.reject(new RemoteRequestLost({ op: claimed.op, reason }))
      }
    },

    failWaiting({ reason }) {
      redrivable.clear()
      for (const [id, claimed] of [...waiting]) {
        waiting.delete(id)
        unwritten.delete(id)
        dropQueued(id)
        claimed.reject(new RemoteRequestLost({ op: claimed.op, reason }))
      }
    },

    unackedSendCount: () => pendingAcks.size,

    attach({ write: writer }) {
      write = writer
      for (const frame of queued.splice(0, queued.length)) {
        if (!writer(encodeFrame(frame))) {
          queued.push(frame)
          continue
        }
        emitted(frame)
      }
    },

    detach({ reason }) {
      write = null

      for (const [id, claimed] of [...waiting]) {
        if (redrivable.has(id)) continue
        waiting.delete(id)
        unwritten.delete(id)
        claimed.reject(new RemoteRequestLost({ op: claimed.op, reason }))
      }

      const kept = queued.filter(
        (frame) => frame.kind !== EClientFrame.Request || redrivable.has(frame.id),
      )
      queued.splice(0, queued.length, ...kept)

      const unsent = new Set(
        queued.flatMap((frame) => (frame.kind === EClientFrame.Request ? [frame.id] : [])),
      )
      for (const [id, frame] of [...redrivable]) {
        if (unsent.has(id) || !waiting.has(id)) continue
        queued.push(frame)
      }

      // A socket that took the bytes locally can still drop the frame before serve commits it, so a
      // send is re-driven until the ack lands — serve dedupes the sendId of one that did commit.
      const unacked = new Set(
        queued.flatMap((frame) => (frame.kind === EClientFrame.Send ? [frame.sendId] : [])),
      )
      for (const [sendId, frame] of [...pendingAcks]) {
        if (unacked.has(sendId)) continue
        queued.push(frame)
      }
    },
  }
}
