import type { ThreadId } from '@dltech/atlas-core'
import type { DeltaChannel } from '@dltech/atlas-harness'
import { isApiProvisioned, mirrorsThreadState } from '@dltech/atlas-wire'

import type { ServeApp } from './serve-app'
import {
  createChildMirror,
  httpRegisterChild,
  isSettledSignal,
  type ChildIdentity,
  type ChildMirror,
  type RegisterChild,
} from './serve-child-mirror'
import { createEventFlusher, httpPostPodEvents, httpTruncatePodEvents } from './serve-event-flush'
import { mirrorHistoryEdits } from './serve-history-mirror'
import type { ServeLog } from './serve-log'

export type ServeWriteBehind = {
  flush: () => Promise<boolean>
  detach: () => void
}

type WriteBehindApp = Pick<ServeApp, 'log' | 'rewind' | 'compaction'> & {
  channel: Pick<DeltaChannel, 'subscribe'>
  threads?: Pick<ServeApp['threads'], 'spawned'> | undefined
  roster?: Pick<NonNullable<ServeApp['roster']>, 'snapshot' | 'subscribe'> | undefined
}

async function persistedChildren(args: {
  root: ThreadId
  threads: Pick<ServeApp['threads'], 'spawned'>
}): Promise<ChildIdentity[]> {
  const found: ChildIdentity[] = []
  const visited = new Set<ThreadId>([args.root])
  const queue: ThreadId[] = [args.root]
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const child of await args.threads.spawned({ threadId: parent })) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      queue.push(child.id)
      found.push({
        threadId: child.id,
        spawnedBy: child.agent?.spawnedBy ?? parent,
        agentType: child.agent?.type ?? 'agent',
      })
    }
  }
  return found
}

export function bindServeWriteBehind(args: {
  env: Record<string, string | undefined>
  app: WriteBehindApp
  threadId: ThreadId
  durableHead: number
  remote: { controlPlaneUrl: string; token: string; clientVersion: string; fetchFn: typeof fetch }
  log: ServeLog
  register?: RegisterChild | undefined
}): ServeWriteBehind | undefined {
  if (!mirrorsThreadState(args.env)) return undefined
  const { app, remote, log } = args
  const refusalSettles = !isApiProvisioned(args.env)
  const flusher = createEventFlusher({
    threadId: args.threadId,
    events: app.log,
    durableHead: args.durableHead,
    post: httpPostPodEvents(remote),
    truncate: httpTruncatePodEvents(remote),
    refusalSettles,
    log,
  })
  const register = args.register ?? httpRegisterChild(remote)
  const children = new Map<ThreadId, ChildMirror>()
  const dropped = new Set<ThreadId>()
  let discovery: Promise<void> = Promise.resolve()

  const adopt = (child: ChildIdentity) => {
    if (children.has(child.threadId) || dropped.has(child.threadId)) return
    const mirror = createChildMirror({
      child,
      events: app.log,
      channel: app.channel,
      register,
      remote,
      refusalSettles,
      log,
    })
    children.set(child.threadId, mirror)
    void mirror.flush()
  }

  const discover = () => {
    discovery = discovery.then(async () => {
      for (const agent of app.roster?.snapshot().agents ?? []) {
        adopt({ threadId: agent.agentId, spawnedBy: agent.spawnedBy, agentType: agent.agentType })
      }
      if (app.threads === undefined) return
      try {
        for (const child of await persistedChildren({
          root: args.threadId,
          threads: app.threads,
        })) {
          adopt(child)
        }
      } catch {
        return
      }
    })
    return discovery
  }

  const rewindTruncate = app.rewind?.truncate
  if (app.rewind !== undefined && rewindTruncate !== undefined) {
    app.rewind.truncate = async (given) => {
      for (const cut of given.cutAgents) {
        dropped.add(cut)
        children.get(cut)?.detach()
        children.delete(cut)
      }
      return rewindTruncate(given)
    }
  }
  mirrorHistoryEdits({
    app,
    flusherFor: (threadId) => (threadId === args.threadId ? flusher : children.get(threadId)),
  })

  const unsubscribeRoot = app.channel.subscribe({
    threadId: args.threadId,
    listener: (signal) => {
      if (isSettledSignal(signal)) void flusher.flush()
    },
  })
  const unsubscribeRoster = app.roster?.subscribe(() => void discover())
  void flusher.flush()
  void discover()

  return {
    flush: async () => {
      await discovery
      const results = await Promise.all([
        flusher.flush(),
        ...[...children.values()].map((mirror) => mirror.flush()),
      ])
      return results.every(Boolean)
    },
    detach: () => {
      unsubscribeRoot()
      unsubscribeRoster?.()
      for (const mirror of children.values()) mirror.detach()
      children.clear()
    },
  }
}
