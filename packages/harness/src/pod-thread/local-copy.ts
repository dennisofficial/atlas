import type { Event, ThreadId } from '@dltech/atlas-core'

import { EConnectionView } from '../cloud/connection-view'
import type { ChannelReload, RemoteDeltaChannel } from '../cloud/remote-delta-channel'
import { mirrorWriter } from '../cloud/mirror-writer'
import { registryFor, type SessionRegistry } from '../store/sessions/registry'
import type { ThreadModel, ThreadStorePort } from '../store/thread-store'

export type LocalCopyChannel = Pick<RemoteDeltaChannel, 'threadId' | 'onReload' | 'connection'> & {
  onReady(listener: () => void): () => void
  subscribe(args: { threadId: ThreadId; listener: (signal: { type: string }) => void }): () => void
}

export type LocalCopyRemote = {
  log: { readOwn(args: { threadId: ThreadId; fromSeq?: number }): Promise<Event[]> }
  threads: {
    find(args: {
      threadId: ThreadId
    }): Promise<{ title?: string | undefined; model?: ThreadModel | undefined } | undefined>
    onModelChosen(
      listener: (chosen: { threadId: ThreadId; model: ThreadModel }) => void,
    ): () => void
  }
}

export type LocalCopyHome = Pick<ThreadStorePort, 'find' | 'rename' | 'chooseModel'>

export type PodLocalCopy = { stop(): void; settled(): Promise<void> }

const firstDivergence = (args: { local: readonly Event[]; remote: readonly Event[] }): number => {
  const shared = Math.min(args.local.length, args.remote.length)
  for (let index = 0; index < shared; index += 1) {
    if (args.local[index]?.id !== args.remote[index]?.id) return index
  }
  return shared
}

const sameModel = (args: { held: ThreadModel | undefined; pod: ThreadModel }): boolean =>
  args.held?.ref === args.pod.ref && args.held.effort === args.pod.effort

/** Keeps a pod thread's events, title and model in the home session files while it is attached. */
export function startPodLocalCopy(args: {
  home: string
  threadId: ThreadId
  channel: LocalCopyChannel
  remote: LocalCopyRemote
  homeThreads: LocalCopyHome
  registry?: (() => SessionRegistry) | undefined
}): PodLocalCopy {
  const { threadId, remote, homeThreads } = args
  const registryOf = (): SessionRegistry => args.registry?.() ?? registryFor({ home: args.home })
  const writer = mirrorWriter({ home: () => args.home, registry: registryOf })
  let stopped = false
  let chain: Promise<void> = Promise.resolve()

  const localEvents = async (): Promise<{ events: readonly Event[]; head: number }> => {
    const registry = registryOf()
    const sessionDir = await registry.sessionDirFor({ threadId })
    registry.invalidateSession({ sessionDir })
    return registry.readThreadLog({ sessionDir, threadId })
  }

  const reconcile = async (): Promise<void> => {
    const [local, mirrored] = await Promise.all([localEvents(), remote.log.readOwn({ threadId })])
    const from = firstDivergence({ local: local.events, remote: mirrored })
    if (from === local.events.length && from === mirrored.length) return
    if (stopped) return
    const fromSeq = local.events[from]?.seq ?? mirrored[from]?.seq ?? local.head + 1
    await writer.rewriteFrom({
      threadId,
      fromSeq,
      events: mirrored.filter((event) => event.seq >= fromSeq),
    })
  }

  const sync = async (): Promise<void> => {
    const { events, head } = await localEvents()
    const last = events.at(-1)
    const fresh = await remote.log.readOwn({
      threadId,
      fromSeq: last === undefined ? head : head - 1,
    })
    if (stopped) return
    if (last !== undefined) {
      const anchor = fresh[0]
      if (anchor?.seq !== last.seq || anchor.id !== last.id) return reconcile()
      fresh.shift()
    }
    if (fresh.length === 0) return
    const appended = await writer.appendFrom({ threadId, events: fresh })
    if (appended.gapAt !== undefined) await reconcile()
  }

  const syncMeta = async (): Promise<void> => {
    const [pod, held] = await Promise.all([
      remote.threads.find({ threadId }),
      homeThreads.find({ threadId }),
    ])
    if (stopped || pod === undefined || held === undefined) return
    if (pod.model !== undefined && !sameModel({ held: held.model, pod: pod.model }))
      await homeThreads.chooseModel({ threadId, model: pod.model })
  }

  const queue = (task: () => Promise<void>): void => {
    chain = chain.then(async () => {
      if (stopped) return
      await task().catch(() => undefined)
    })
  }

  const unsubscribers = [
    args.channel.onReady(() => {
      queue(sync)
      queue(syncMeta)
    }),
    args.channel.onReload((reload: ChannelReload) =>
      queue(reload.sinceEventSeq === 0 ? reconcile : sync),
    ),
    args.channel.subscribe({
      threadId,
      listener: (signal) => {
        if (signal.type === 'events-appended') queue(sync)
      },
    }),
    remote.threads.onModelChosen((chosen) => {
      if (chosen.threadId !== threadId) return
      queue(() => homeThreads.chooseModel({ threadId, model: chosen.model }))
    }),
  ]

  if (args.channel.connection().state !== EConnectionView.Parked) {
    queue(sync)
    queue(syncMeta)
  }

  return {
    stop: () => {
      stopped = true
      for (const unsubscribe of unsubscribers) unsubscribe()
    },
    settled: () => chain,
  }
}
