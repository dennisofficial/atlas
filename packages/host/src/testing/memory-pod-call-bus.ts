import type {
  PodCallReply,
  PodCallReplyOutcome,
  PodCallRequest,
  PodReady,
  PodStreamFrame,
} from '@dltech/atlas-protocol'

import type { PodCallBus } from '../holder/pod-call-port'

export type PodCallHub = { bus(): PodCallBus }

type Settle = (outcome: PodCallReplyOutcome) => void

const deliver = (work: () => void): void => {
  queueMicrotask(work)
}

export const createMemoryPodCallHub = (): PodCallHub => {
  let issued = 0
  const requestListeners = new Set<(request: PodCallRequest) => void>()
  const readyListeners = new Set<(ready: PodReady) => void>()
  const frameListeners = new Map<string, Set<(frame: PodStreamFrame) => void>>()
  const pending = new Map<string, Settle>()

  const keyOf = (args: { replyTo: string; requestId: string }): string =>
    `${args.replyTo}\u0000${args.requestId}`

  return {
    bus: (): PodCallBus => {
      issued += 1
      const requesterId = `memory-requester-${issued}`
      const ownRequestListeners = new Set<(request: PodCallRequest) => void>()
      const ownReadyListeners = new Set<(ready: PodReady) => void>()
      const ownFrameListeners = new Map<string, Set<(frame: PodStreamFrame) => void>>()
      let closed = false

      const forget = (): void => {
        closed = true
        for (const listener of ownRequestListeners) requestListeners.delete(listener)
        ownRequestListeners.clear()
        for (const listener of ownReadyListeners) readyListeners.delete(listener)
        ownReadyListeners.clear()
        for (const [streamId, listeners] of ownFrameListeners) {
          const hubListeners = frameListeners.get(streamId)
          if (hubListeners === undefined) continue
          for (const listener of listeners) hubListeners.delete(listener)
          if (hubListeners.size === 0) frameListeners.delete(streamId)
        }
        ownFrameListeners.clear()
      }

      return {
        requesterId,
        request: (args) =>
          new Promise<PodCallReplyOutcome>((resolve, reject) => {
            const { requestId } = args.request
            const key = keyOf({ replyTo: requesterId, requestId })
            const settle = (outcome: PodCallReplyOutcome): void => {
              clearTimeout(timer)
              args.signal?.removeEventListener('abort', abort)
              pending.delete(key)
              resolve(outcome)
            }
            const fail = (message: string): void => {
              clearTimeout(timer)
              args.signal?.removeEventListener('abort', abort)
              pending.delete(key)
              reject(new Error(message))
            }
            let timer: ReturnType<typeof setTimeout> | undefined
            const abort = (): void => fail(`pod call ${requestId} was aborted`)
            timer = setTimeout(
              () => fail(`pod call ${requestId} timed out after ${args.timeoutMs}ms`),
              args.timeoutMs,
            )
            pending.set(key, settle)
            args.signal?.addEventListener('abort', abort)
            if (args.signal?.aborted === true) {
              fail(`pod call ${requestId} was aborted`)
              return
            }
            deliver(() => {
              for (const listener of [...requestListeners]) listener(args.request)
            })
          }),
        onRequest: (listener) => {
          requestListeners.add(listener)
          ownRequestListeners.add(listener)
          return () => {
            requestListeners.delete(listener)
            ownRequestListeners.delete(listener)
          }
        },
        reply: async (args: { replyTo: string; reply: PodCallReply }): Promise<void> => {
          const settle = pending.get(
            keyOf({ replyTo: args.replyTo, requestId: args.reply.requestId }),
          )
          if (settle === undefined) return
          deliver(() => settle(args.reply.outcome))
        },
        publishFrame: async (args: { streamId: string; frame: PodStreamFrame }): Promise<void> => {
          deliver(() => {
            for (const listener of [...(frameListeners.get(args.streamId) ?? [])]) {
              listener(args.frame)
            }
          })
        },
        subscribeFrames: async (args: {
          streamId: string
          listener: (frame: PodStreamFrame) => void
        }): Promise<() => Promise<void>> => {
          const listeners = frameListeners.get(args.streamId) ?? new Set()
          listeners.add(args.listener)
          frameListeners.set(args.streamId, listeners)
          const own = ownFrameListeners.get(args.streamId) ?? new Set()
          own.add(args.listener)
          ownFrameListeners.set(args.streamId, own)
          return async () => {
            listeners.delete(args.listener)
            own.delete(args.listener)
            if (listeners.size === 0) frameListeners.delete(args.streamId)
          }
        },
        ready: async (ready: PodReady): Promise<void> => {
          deliver(() => {
            for (const listener of [...readyListeners]) listener(ready)
          })
        },
        onReady: (listener) => {
          readyListeners.add(listener)
          ownReadyListeners.add(listener)
          return () => {
            readyListeners.delete(listener)
            ownReadyListeners.delete(listener)
          }
        },
        close: async (): Promise<void> => {
          if (closed) return
          forget()
        },
      }
    },
  }
}
