import type { ThreadId } from '@dltech/atlas-core'
import { EConnectionView } from '../cloud/connection-view'
import { createRemoteDeltaChannel } from '../cloud/remote-delta-channel'
import { RemoteEventLog } from '../cloud/remote-event-log'
import { RemoteThreadStore } from '../cloud/remote-thread-store'
import { startPodLocalCopy, type LocalCopyHome, type PodLocalCopy } from '../pod-thread/local-copy'
import { RemoteSessionActivity } from './remote-session-activity'
import type { LocalActivityConnection, LocalActivityEndpoint } from './local-inspection'

export function createPassiveActivityConnection(args: {
  threadId: ThreadId
  endpoint: LocalActivityEndpoint
  token(args: { threadId: ThreadId }): string | undefined
  invalidate(): void
  disconnect(): void
  home?: { path: string; threads: LocalCopyHome }
  timeoutMs?: number
}): LocalActivityConnection {
  const token = args.token({ threadId: args.threadId })
  if (token === undefined || token.length === 0)
    throw new Error('Existing activity credential unavailable')
  const timeoutMs = args.timeoutMs ?? 5_000
  const timeouts = new Set<ReturnType<typeof setTimeout>>()
  const channel = createRemoteDeltaChannel({
    threadId: args.threadId,
    url: args.endpoint.url,
    token,
    readsWake: false,
    maxAttempts: 0,
    requestTimeoutMs: timeoutMs,
    scheduleRetry: () => undefined,
    scheduleTimeout: ({ delayMs, run }) => {
      const timeout = setTimeout(() => {
        timeouts.delete(timeout)
        run()
      }, delayMs)
      timeout.unref()
      timeouts.add(timeout)
    },
  })
  let closed = false
  let shutdown: Promise<void> | undefined
  let connected = false
  let copy: PodLocalCopy | undefined
  const unsubscribers: (() => void)[] = []
  let resolveReady: () => void = () => undefined
  let rejectReady: (error: Error) => void = () => undefined
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  void ready.catch(() => undefined)
  const timer = setTimeout(() => {
    rejectReady(new Error('Activity connection timed out'))
    void close()
    args.disconnect()
  }, timeoutMs)
  const close = (): Promise<void> => {
    if (shutdown !== undefined) return shutdown
    closed = true
    clearTimeout(timer)
    for (const timeout of timeouts) clearTimeout(timeout)
    timeouts.clear()
    copy?.stop()
    for (const unsubscribe of unsubscribers) unsubscribe()
    rejectReady(new Error('Activity connection closed'))
    channel.close()
    shutdown = copy?.settled() ?? Promise.resolve()
    return shutdown
  }
  const guarded = {
    request: (request: Parameters<typeof channel.request>[0]) => {
      if (closed) return Promise.reject(new Error('Activity connection closed'))
      const response = channel.requestIfConnected?.(request)
      return response ?? Promise.reject(new Error('Activity connection unavailable'))
    },
    onThreadRenamed: channel.onThreadRenamed,
    onThreadModelChanged: channel.onThreadModelChanged,
  }
  const handleConnection = (): void => {
    if (closed) return
    const state = channel.connection().state
    if (state === EConnectionView.Connected) {
      connected = true
      clearTimeout(timer)
      if (args.home !== undefined && copy === undefined) {
        copy = startPodLocalCopy({
          home: args.home.path,
          threadId: args.threadId,
          channel,
          remote: {
            log: new RemoteEventLog({ channel: guarded }),
            threads: new RemoteThreadStore({ channel: guarded }),
          },
          homeThreads: args.home.threads,
        })
      }
      resolveReady()
      return
    }
    if (connected || state === EConnectionView.Disconnected || state === EConnectionView.Parked) {
      void close()
      args.disconnect()
    }
  }
  unsubscribers.push(
    channel.onConnection(handleConnection),
    channel.onReady(args.invalidate),
    channel.onRoster(args.invalidate),
    channel.onTurnEnded(args.invalidate),
    channel.onError(args.invalidate),
    channel.onServerError(args.invalidate),
    channel.onReload(args.invalidate),
    channel.subscribe({ threadId: args.threadId, listener: args.invalidate }),
  )
  handleConnection()
  const activity = new RemoteSessionActivity({ channel })
  return {
    async read() {
      await ready
      if (closed || channel.connection().state !== EConnectionView.Connected)
        throw new Error('Activity connection unavailable')
      const snapshot = await activity.read({ threadId: args.threadId })
      if (closed || channel.connection().state !== EConnectionView.Connected)
        throw new Error('Activity connection changed')
      return snapshot
    },
    async settled() {
      await ready
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          copy?.settled() ?? Promise.resolve(),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error('Activity history copy timed out')),
              timeoutMs,
            )
            deadline.unref()
          }),
        ])
        if (closed) throw new Error('Activity connection unavailable')
      } catch (error) {
        await close()
        args.disconnect()
        throw error
      } finally {
        clearTimeout(deadline)
      }
    },
    close,
  }
}
