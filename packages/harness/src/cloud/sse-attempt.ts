import { httpStatusOf } from '@dltech/atlas-api-router'
import { EGithubPrStreamFrame, type GithubPrStreamFrame } from '@dltech/atlas-wire'

import { createStreamClient } from './sse-stream-client'
import { SseRefused, type SseHandlers, type SsePrFrame } from './sse-types'

const REFUSAL_STATUSES: readonly number[] = [401, 403]

const isRefusal = (status: number | undefined): status is number =>
  status !== undefined && REFUSAL_STATUSES.includes(status)

export type AttemptEnd = { kind: 'drop' } | { kind: 'aborted' }

export const runAttempt = (args: {
  baseUrl: string
  token: string
  clientVersion: string
  signal: AbortSignal
  handlers: SseHandlers
  silenceTimeoutMs: number
  onCaughtUp: () => void
}): Promise<AttemptEnd> =>
  new Promise<AttemptEnd>((resolve, reject) => {
    let settled = false
    let opened = false
    let catchingUp = true
    let watchdog: ReturnType<typeof setTimeout> | null = null
    let unsubscribe: (() => void) | null = null
    let handshakeStatus: number | undefined
    const buffered: SsePrFrame[] = []

    const clearWatchdog = (): void => {
      if (watchdog === null) return
      clearTimeout(watchdog)
      watchdog = null
    }

    const finish = (end: AttemptEnd | SseRefused): void => {
      if (settled) return
      settled = true
      clearWatchdog()
      args.signal.removeEventListener('abort', handleAbort)
      unsubscribe?.()
      if (end instanceof SseRefused) reject(end)
      else resolve(end)
    }

    const drop = (): void => finish({ kind: 'drop' })

    function handleAbort(): void {
      finish({ kind: 'aborted' })
    }

    const arm = (): void => {
      if (settled) return
      clearWatchdog()
      watchdog = setTimeout(drop, args.silenceTimeoutMs)
      watchdog.unref?.()
    }

    const deliver = (frame: SsePrFrame): void => {
      try {
        args.handlers.onFrame(frame)
      } catch {
        drop()
      }
    }

    const settleCatchUp = (): void => {
      if (settled) return
      args.onCaughtUp()
      catchingUp = false
      for (const frame of buffered.splice(0)) deliver(frame)
    }

    const open = (): void => {
      let catchUp: void | Promise<void>
      try {
        catchUp = args.handlers.onOpen?.()
      } catch (failure) {
        finish(failure instanceof SseRefused ? failure : { kind: 'drop' })
        return
      }
      if (catchUp === undefined) {
        settleCatchUp()
        return
      }
      catchUp.then(settleCatchUp, (failure: unknown) => {
        finish(failure instanceof SseRefused ? failure : { kind: 'drop' })
      })
    }

    const handleData = (frame: GithubPrStreamFrame): void => {
      if (settled) return
      arm()
      if (!opened) {
        opened = true
        open()
      }
      if (frame.type === EGithubPrStreamFrame.Heartbeat) return
      if (catchingUp) buffered.push(frame)
      else deliver(frame)
    }

    if (args.signal.aborted) {
      resolve({ kind: 'aborted' })
      return
    }
    args.signal.addEventListener('abort', handleAbort, { once: true })

    const client = createStreamClient({
      baseUrl: args.baseUrl,
      token: args.token,
      clientVersion: args.clientVersion,
      onBytes: arm,
      onStatus: (status) => {
        handshakeStatus = status
      },
    })
    arm()
    const subscription = client.githubPrs.stream.subscribe(undefined, {
      onStarted: arm,
      onData: handleData,
      onError: (failure) => {
        const status = httpStatusOf(failure) ?? handshakeStatus
        finish(isRefusal(status) ? new SseRefused(status) : { kind: 'drop' })
      },
      onConnectionStateChange: (state) => {
        if (state.state === 'connecting' && state.error !== null) drop()
      },
      onComplete: drop,
      onStopped: drop,
    })
    unsubscribe = () => subscription.unsubscribe()
    if (settled) unsubscribe()
  })
