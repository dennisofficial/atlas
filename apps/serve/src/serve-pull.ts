import { awaitsReply, type ThreadId } from '@dltech/atlas-core'
import { SessionsClient } from '@dltech/atlas-harness'
import { mirrorsThreadState } from '@dltech/atlas-wire'

import type { ServeApp } from './serve-app'
import { hydrateServeHistory } from './serve-hydrate'
import { EServeEvent, type ServeLog } from './serve-log'
import { wakeChildrenWithPendingInput } from './serve-pending-children'
import type { ServeTurnDriver } from './turn-driver'

export const PULL_RECONNECT_DELAY_MS = 3_000

export type PullRemote = {
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
}

export type PullSubscribe = (args: { onTick: () => void }) => () => void

const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function watchEventsFor(args: {
  sessions: Pick<SessionsClient, 'watchEvents'>
  threadId: ThreadId
  log: ServeLog
  reconnectDelayMs?: number | undefined
}): PullSubscribe {
  const delayMs = args.reconnectDelayMs ?? PULL_RECONNECT_DELAY_MS
  return ({ onTick }) => {
    let stopped = false
    let stopStream: () => void = () => undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const reconnectLater = (): void => {
      if (stopped || timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        connect()
      }, delayMs)
    }

    function connect(): void {
      if (stopped) return
      stopStream()
      stopStream = args.sessions.watchEvents({
        threadId: args.threadId,
        onTick,
        onFailure: (reason) => {
          args.log({ event: EServeEvent.PullFailed, reason: `watching events failed: ${reason}` })
          reconnectLater()
        },
        onEnded: reconnectLater,
      })
    }

    connect()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      stopStream()
    }
  }
}

export function bindServePull(args: {
  env: Record<string, string | undefined>
  threadId: ThreadId
  atlasHome: string
  remote: PullRemote
  app: {
    log: Pick<ServeApp['log'], 'readOwn' | 'refresh'>
    roster?: ServeApp['roster'] | undefined
    agents?: ServeApp['agents'] | undefined
  }
  driver: Pick<ServeTurnDriver, 'run' | 'busy'>
  log: ServeLog
  hydrate?: ((threadId: ThreadId) => Promise<unknown>) | undefined
  subscribe?: PullSubscribe | undefined
}): () => void {
  if (!mirrorsThreadState(args.env)) return () => undefined
  const { threadId, app, driver, log } = args
  const sessions = new SessionsClient({
    url: args.remote.controlPlaneUrl,
    token: args.remote.token,
    clientVersion: args.remote.clientVersion,
    fetchFn: args.remote.fetchFn,
  })
  const hydrate =
    args.hydrate ??
    ((asked: ThreadId) =>
      hydrateServeHistory({ atlasHome: args.atlasHome, threadId: asked, sessions, log }))
  const subscribe = args.subscribe ?? watchEventsFor({ sessions, threadId, log })

  const refreshChild = async (childId: ThreadId): Promise<void> => {
    await hydrate(childId)
    await app.log.refresh({ threadId: childId })
  }

  const pullOnce = async (): Promise<void> => {
    try {
      await hydrate(threadId)
      await app.log.refresh({ threadId })
      const events = await app.log.readOwn({ threadId })
      if (awaitsReply(events) && !driver.busy()) driver.run({ resume: false, onlyIfIdle: true })
      // A message appended to a family (teammate) thread ticks the pod root's stream, not the
      // child's — the watch is root-scoped — so a tick sweeps the family for unanswered input.
      if (app.agents !== undefined && app.roster !== undefined) {
        await wakeChildrenWithPendingInput({
          app: { log: app.log, roster: app.roster, agents: app.agents },
          threadId,
          log,
          refreshChild,
        })
      }
    } catch (failure) {
      log({ event: EServeEvent.PullFailed, reason: reasonOf(failure) })
    }
  }

  let detached = false
  let pulling: Promise<void> | undefined
  let followUp = false

  const drain = async (): Promise<void> => {
    do {
      followUp = false
      await pullOnce()
    } while (followUp && !detached)
    pulling = undefined
  }

  const handleTick = (): void => {
    if (detached) return
    if (pulling !== undefined) {
      followUp = true
      return
    }
    pulling = drain()
  }

  const unsubscribe = subscribe({ onTick: handleTick })
  const unsubscribeRoster = app.roster?.subscribe(handleTick)
  return () => {
    detached = true
    unsubscribe()
    unsubscribeRoster?.()
  }
}
