import {
  EWaitEpisodeKind,
  projectWaiting,
  waitEpisodeGroupKey,
  type EventDraft,
  type EventLogPort,
  type IdPort,
  type ThreadId,
  type WaitEpisodeRef,
  type WaitingForModel,
} from '@dltech/atlas-core'

import type { ThreadStorePort } from '../store'
import { rootThreadOf } from './root-thread'

type WaitStateDeps = {
  log: Pick<EventLogPort, 'append' | 'readOwn'>
  ids: Pick<IdPort, 'nextRunId'>
  threads: Pick<ThreadStorePort, 'find'>
}

export type ModelWaitObserver = Pick<ModelWaitState, 'observe' | 'admitted' | 'blocked'>

export type ModelWaitView = Pick<ModelWaitState, 'blocked' | 'subscribe'>

const generationOf = (waiting: WaitingForModel): number =>
  waiting.episode.kind === EWaitEpisodeKind.Credential ? waiting.episode.generation : 0

const union = (first: readonly ThreadId[], second: readonly ThreadId[]): readonly ThreadId[] => [
  ...new Set([...first, ...second]),
]

const keyOf = (waiting: WaitingForModel): string => waitEpisodeGroupKey(waiting.episode)

export class ModelWaitState {
  private readonly held = new Map<ThreadId, readonly WaitingForModel[]>()
  private readonly pending = new Map<ThreadId, Map<string, WaitingForModel>>()
  private readonly roots = new Map<ThreadId, ThreadId>()
  private readonly serialized = new Map<ThreadId, Promise<unknown>>()
  private readonly flushes = new Map<ThreadId, Promise<void>>()
  private readonly opened = new Set<ThreadId>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly deps: WaitStateDeps) {}

  blocked({ threadId }: { threadId: ThreadId }): boolean {
    return this.unresolved().some((waiting) => waiting.affectedThreadIds.includes(threadId))
  }

  async episodeOf({ threadId }: { threadId: ThreadId }): Promise<WaitEpisodeRef | undefined> {
    await this.open({ threadId })
    return this.unresolved().find((waiting) => waiting.affectedThreadIds.includes(threadId))
      ?.episode
  }

  waiting(): readonly WaitingForModel[] {
    return this.unresolved()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  async open({ threadId }: { threadId: ThreadId }): Promise<void> {
    const root = await this.rootOf(threadId)
    await this.serial({ root, run: () => this.hydrate(root) })
  }

  async observe({
    threadId,
    waiting,
  }: {
    threadId: ThreadId
    waiting: WaitingForModel
  }): Promise<void> {
    const root = await this.rootOf(threadId)
    await this.serial({ root, run: () => this.hydrate(root) })
    if (this.covers({ root, waiting })) return
    this.queue({ root, waiting })
    this.notify()
    await this.flush(root)
  }

  async admitted({ threadId }: { threadId: ThreadId }): Promise<void> {
    for (const waiting of this.unresolved()) {
      if (waiting.affectedThreadIds.includes(threadId)) await this.clear({ waiting })
    }
  }

  async clear({ waiting }: { waiting: WaitingForModel }): Promise<void> {
    const key = keyOf(waiting)
    for (const [root, list] of [...this.held]) {
      const current = list.find((one) => keyOf(one) === key)
      if (current === undefined) continue
      await this.serial({
        root,
        run: () =>
          this.append({
            root,
            drafts: [
              {
                type: 'model-wait-cleared',
                episode: current.episode,
                cause: current.cause,
              },
            ],
          }),
      })
    }
  }

  async reconcile({
    eligible,
  }: {
    eligible: (waiting: WaitingForModel) => Promise<boolean>
  }): Promise<void> {
    for (const waiting of this.unresolved()) {
      if (await eligible(waiting)) await this.clear({ waiting })
    }
  }

  private unresolved(): readonly WaitingForModel[] {
    const merged = new Map<string, WaitingForModel>()
    for (const list of this.held.values()) {
      for (const waiting of list) merged.set(keyOf(waiting), waiting)
    }
    for (const batch of this.pending.values()) {
      for (const [key, waiting] of batch) {
        const current = merged.get(key)
        merged.set(
          key,
          current === undefined ? waiting : this.merge({ current, observed: waiting }),
        )
      }
    }
    return [...merged.values()]
  }

  private covers({ root, waiting }: { root: ThreadId; waiting: WaitingForModel }): boolean {
    const current = this.held.get(root)?.find((one) => keyOf(one) === keyOf(waiting))
    if (current === undefined) return false
    const known = waiting.affectedThreadIds.every((id) => current.affectedThreadIds.includes(id))
    if (!known) return false
    if (generationOf(current) > generationOf(waiting)) return true
    return (
      generationOf(current) === generationOf(waiting) &&
      current.reason === waiting.reason &&
      current.resetAt === waiting.resetAt
    )
  }

  private merge({
    current,
    observed,
  }: {
    current: WaitingForModel
    observed: WaitingForModel
  }): WaitingForModel {
    const affectedThreadIds = union(current.affectedThreadIds, observed.affectedThreadIds)
    const newer = generationOf(observed) >= generationOf(current)
    return { ...(newer ? observed : current), affectedThreadIds }
  }

  private queue({ root, waiting }: { root: ThreadId; waiting: WaitingForModel }): void {
    const batch = this.pending.get(root) ?? new Map<string, WaitingForModel>()
    const current = batch.get(keyOf(waiting))
    batch.set(
      keyOf(waiting),
      current === undefined ? waiting : this.merge({ current, observed: waiting }),
    )
    this.pending.set(root, batch)
  }

  private flush(root: ThreadId): Promise<void> {
    const scheduled = this.flushes.get(root)
    if (scheduled !== undefined) return scheduled
    const next = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      this.flushes.delete(root)
      return this.serial({ root, run: () => this.drain(root) })
    })
    this.flushes.set(root, next)
    return next
  }

  private async drain(root: ThreadId): Promise<void> {
    const batch = this.pending.get(root)
    if (batch === undefined) return
    this.pending.delete(root)
    const drafts: EventDraft[] = [...batch.values()]
      .filter((waiting) => !this.covers({ root, waiting }))
      .map((waiting) => ({ type: 'model-waiting', waiting }))
    await this.append({ root, drafts })
  }

  private async append({
    root,
    drafts,
  }: {
    root: ThreadId
    drafts: readonly EventDraft[]
  }): Promise<void> {
    try {
      if (drafts.length > 0) {
        await this.deps.log.append({
          threadId: root,
          runId: this.deps.ids.nextRunId(),
          drafts,
        })
      }
    } finally {
      await this.reload(root)
    }
  }

  private async hydrate(root: ThreadId): Promise<void> {
    if (this.opened.has(root)) return
    await this.reload(root)
    this.opened.add(root)
  }

  private async reload(root: ThreadId): Promise<void> {
    const before = JSON.stringify(this.unresolved())
    this.held.set(root, projectWaiting(await this.deps.log.readOwn({ threadId: root })))
    if (JSON.stringify(this.unresolved()) !== before) this.notify()
  }

  private async rootOf(threadId: ThreadId): Promise<ThreadId> {
    const known = this.roots.get(threadId)
    if (known !== undefined) return known
    const root = await rootThreadOf({ threads: this.deps.threads, threadId })
    this.roots.set(threadId, root)
    return root
  }

  private serial<T>({ root, run }: { root: ThreadId; run: () => Promise<T> }): Promise<T> {
    const prior = this.serialized.get(root) ?? Promise.resolve()
    const next = prior.then(run, run)
    this.serialized.set(
      root,
      next.catch(() => undefined),
    )
    return next
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
