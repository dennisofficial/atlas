import { randomUUID } from 'node:crypto'
import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import type { Logger } from '@nestjs/common'
import { cachedPrStates } from './github-linked-prs'
import type { GithubObservationStore } from './github-observation.store'
import { OBSERVATION_RENEW_MS } from './github-observation.types'
import type { GithubPrFanoutService } from './github-pr-fanout.service'
import type { PrFrameSink } from './github-pr-stream.frames'
import type { GithubSubscriptionsService } from './github-subscriptions.service'

export function attachObservedStates(args: {
  userId: string
  signal?: AbortSignal | undefined
  observe: readonly { repo: string; number: number }[]
  sink: PrFrameSink<GithubPrStatesFrame>
  fanout: GithubPrFanoutService
  subscriptions: GithubSubscriptionsService
  observations: GithubObservationStore
  logger: Logger
}): () => void {
  const id = randomUUID()
  const lifecycle = new AbortController()
  let disposed = false
  let renewing = false
  let lastStatus: string | undefined
  args.sink.push({ type: EGithubPrStatesFrame.Heartbeat })
  const close = args.fanout.openStream({
    userId: args.userId,
    handler: (state) => args.sink.push({ type: EGithubPrStatesFrame.PrState, state }),
    onClosed: () => args.sink.close(),
  })
  void args.subscriptions
    .currentStates({ userId: args.userId })
    .then((states) => {
      if (disposed) return
      for (const state of states) args.sink.push({ type: EGithubPrStatesFrame.PrState, state })
    })
    .catch((failure: unknown) =>
      args.logger.warn(`replaying subscribed PR states failed: ${String(failure)}`),
    )
  const release = async () => {
    try {
      await args.observations.release(id)
    } catch (failure) {
      args.logger.warn(
        `releasing PR observation lease failed; TTL will expire it: ${String(failure)}`,
      )
    }
  }
  const refresh = async () => {
    if (renewing || disposed || args.observe.length === 0) return
    renewing = true
    try {
      const result = await args.observations.acquire({
        id,
        userId: args.userId,
        observe: args.observe,
        signal: lifecycle.signal,
      })
      if (disposed) {
        await release()
        return
      }
      const status = `${result.available}:${result.message ?? ''}`
      if (status !== lastStatus) {
        lastStatus = status
        args.sink.push({
          type: EGithubPrStatesFrame.ObservationStatus,
          available: result.available,
          ...(result.message === undefined ? {} : { message: result.message }),
          ...(result.available ? {} : { retryAfterMs: OBSERVATION_RENEW_MS }),
        })
      }
      const states = await cachedPrStates(result.keys)
      if (disposed) return
      for (const state of states) args.sink.push({ type: EGithubPrStatesFrame.PrState, state })
    } catch (failure) {
      if (disposed) return
      const message =
        'PR observation coordinator unavailable; retrying while cached and webhook stream stays connected'
      args.logger.warn(`${message}: ${String(failure)}`)
      if (lastStatus !== message) {
        lastStatus = message
        args.sink.push({
          type: EGithubPrStatesFrame.ObservationStatus,
          available: false,
          message,
          retryAfterMs: OBSERVATION_RENEW_MS,
        })
      }
    } finally {
      renewing = false
    }
  }
  void refresh()
  const renew = setInterval(() => {
    void refresh()
  }, OBSERVATION_RENEW_MS)
  const heartbeat = setInterval(
    () => args.sink.push({ type: EGithubPrStatesFrame.Heartbeat }),
    30_000,
  )
  const detach = () => {
    if (disposed) return
    disposed = true
    lifecycle.abort()
    clearInterval(renew)
    clearInterval(heartbeat)
    close()
    args.signal?.removeEventListener('abort', detach)
    if (args.observe.length > 0) void release()
  }
  args.signal?.addEventListener('abort', detach, { once: true })
  if (args.signal?.aborted === true) detach()
  return detach
}
