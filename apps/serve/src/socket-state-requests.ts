import type { RuntimeCheckpoint } from '@dltech/atlas-wire'
import {
  EClientFrame,
  EClientRequest,
  EServeFrame,
  type ClientFrame,
  type PendingQueues,
  type ServeFrame,
} from '@dltech/atlas-harness'

import {
  answerTakeBackPending,
  answeredRequest,
  isPendingOp,
  isTranscriptReadOp,
  refusedRequest,
  type RequestFrame,
} from './requests'
import type { SessionSocket } from './socket-session'

export const isReadOnlyFrame = (frame: ClientFrame): boolean =>
  frame.kind === EClientFrame.Request &&
  (isTranscriptReadOp(frame.op) ||
    frame.op === EClientRequest.ListRoster ||
    frame.op === EClientRequest.ReadRuntimeCheckpoint ||
    frame.op === EClientRequest.ReadSessionArchive ||
    frame.op === EClientRequest.ReadMemoryArchive)

export function createMutationTracker(args: { changed?: (() => void) | undefined }) {
  const open = new Map<string, number>()
  return {
    begin: (id: string): void => {
      open.set(id, (open.get(id) ?? 0) + 1)
    },
    observe: (frame: ServeFrame): void => {
      if (frame.kind !== EServeFrame.Reply) return
      const count = open.get(frame.replyTo)
      if (count === undefined) return
      if (count === 1) open.delete(frame.replyTo)
      else open.set(frame.replyTo, count - 1)
      args.changed?.()
    },
    active: (): boolean => open.size > 0,
  }
}

export function routeStateRequest(args: {
  socket: SessionSocket
  frame: RequestFrame
  send: (args: { socket: SessionSocket; frame: ServeFrame }) => void
  checkpoint?: (() => RuntimeCheckpoint | null) | undefined
  pending?: PendingQueues | undefined
}): boolean {
  const { socket, frame, send, pending } = args

  if (frame.op === EClientRequest.ReadRuntimeCheckpoint) {
    send({ socket, frame: answeredRequest({ replyTo: frame.id, data: { checkpoint: args.checkpoint?.() ?? null } }) })
    return true
  }

  if (!isPendingOp(frame.op)) return false

  if (pending === undefined) {
    send({ socket, frame: refusedRequest({ replyTo: frame.id, message: 'this serve has no pending queue' }) })
    return true
  }
  void answerTakeBackPending({ frame, pending })
    .then((reply) => send({ socket, frame: reply }))
    .catch((error: unknown) =>
      send({
        socket,
        frame: refusedRequest({
          replyTo: frame.id,
          message: error instanceof Error ? error.message : 'the take-back failed',
        }),
      }),
    )
  return true
}
