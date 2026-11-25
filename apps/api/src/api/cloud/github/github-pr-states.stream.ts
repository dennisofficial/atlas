import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import type { Logger } from '@nestjs/common'
import type { GithubPrFanoutService } from '@dltech/atlas-github'
import { prIdentity } from '@dltech/atlas-github'
import type { GithubPrStateDto } from '@dltech/atlas-github'
import type { GithubSubscriptionsService } from '@dltech/atlas-github'
import type { PrFrameSink } from '@dltech/atlas-github'

export const PR_STATES_HEARTBEAT_MS = 30_000

export function attachPrStates(args: {
  userId: string
  signal?: AbortSignal | undefined
  sink: PrFrameSink<GithubPrStatesFrame>
  fanout: GithubPrFanoutService
  subscriptions: GithubSubscriptionsService
  logger: Logger
}): () => void {
  const seen = new Map<string, number>()
  let disposed = false

  const push = (state: GithubPrStateDto): void => {
    const key = prIdentity(state)
    const held = seen.get(key)
    if (held !== undefined && state.version <= held) return
    seen.set(key, state.version)
    args.sink.push({ type: EGithubPrStatesFrame.PrState, state })
  }

  const handleConnect = async (): Promise<void> => {
    try {
      const states = await args.subscriptions.currentStates({ userId: args.userId })
      if (disposed) return
      for (const state of states) push(state)
    } catch (failure) {
      args.logger.warn(`replaying subscribed PR states failed: ${String(failure)}`)
    }
  }

  args.sink.push({ type: EGithubPrStatesFrame.Heartbeat })
  const closeStream = args.fanout.openStream({
    userId: args.userId,
    handler: push,
    onClosed: () => args.sink.close(),
  })
  void handleConnect()
  const heartbeat = setInterval(() => {
    args.sink.push({ type: EGithubPrStatesFrame.Heartbeat })
  }, PR_STATES_HEARTBEAT_MS)

  const detach = (): void => {
    if (disposed) return
    disposed = true
    clearInterval(heartbeat)
    closeStream()
    args.signal?.removeEventListener('abort', detach)
  }
  args.signal?.addEventListener('abort', detach, { once: true })
  if (args.signal?.aborted === true) detach()
  return detach
}
