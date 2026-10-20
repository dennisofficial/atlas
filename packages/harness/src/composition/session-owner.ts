import type { ThreadId } from '@dltech/atlas-core'

import type { PlacementController } from './placement-controller'
import { createSessionFreezes, type FreezeSource } from './session-freezes'
import { createRetirementQueue } from './session-retirement'
import {
  type BirthInstall,
  type OwnerSnapshot,
  type RuntimeBinding,
  type SessionOwner,
} from './session-owner-types'

export { ERuntimeKind } from './session-owner-types'
export type {
  BirthInstall,
  OwnerSnapshot,
  RuntimeBinding,
  SessionOwner,
  SessionRuntime,
} from './session-owner-types'

export function createSessionOwner<Adapters>(args: {
  placement: PlacementController
  freeze?: FreezeSource | undefined
}): SessionOwner<Adapters> {
  const { placement } = args
  const listeners = new Set<() => void>()
  let cloud: { threadId: ThreadId; binding: RuntimeBinding<Adapters> } | undefined
  let staged: { threadId: ThreadId; binding: RuntimeBinding<Adapters> } | undefined
  const freezes = createSessionFreezes()
  const attachments = new Set<ThreadId>()

  const releaseFreeze = (threadId: ThreadId): void => freezes.release(threadId)

  const holdFreeze = (threadId: ThreadId): Promise<void> =>
    freezes.hold({
      threadId,
      freeze: (cloud?.threadId === threadId ? cloud.binding.freeze : undefined) ?? args.freeze,
    })

  const retiring = createRetirementQueue<RuntimeBinding<Adapters>>()

  const notify = (): void => {
    retiring.flush()
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        continue
      }
    }
  }

  const retireCloud = (): void => {
    const retired = cloud
    cloud = undefined
    if (retired !== undefined) retiring.push(retired.binding)
  }

  const install = (held: { threadId: ThreadId; binding: RuntimeBinding<Adapters> }): void => {
    if (cloud !== undefined && cloud.binding !== held.binding) retireCloud()
    cloud = { threadId: held.threadId, binding: held.binding }
  }

  // A committed cloud birth publishes its placement; the staged binding rides that publish so the
  // durable write and the runtime install land together.
  placement.beforePublish(({ threadId }) => {
    if (staged === undefined || staged.threadId !== threadId) return
    const held = staged
    staged = undefined
    install(held)
  })
  placement.subscribe(notify)

  let cached: OwnerSnapshot<Adapters> | undefined

  const snapshot = (): OwnerSnapshot<Adapters> => {
    const threadId = placement.activeThread()
    const record = threadId === undefined ? undefined : placement.snapshot(threadId)
    const binding = cloud !== undefined && cloud.threadId === threadId ? cloud.binding : undefined
    const placed = record !== undefined
    const bound = binding !== undefined
    if (
      cached !== undefined &&
      cached.threadId === threadId &&
      cached.placed === placed &&
      cached.record === record &&
      cached.binding === binding &&
      cached.bound === bound
    ) {
      return cached
    }
    cached = { threadId, placed, record, binding, bound }
    return cached
  }

  const require = (): RuntimeBinding<Adapters> => {
    const { binding } = snapshot()
    if (binding === undefined) throw new Error('the session runtime is not attached — nothing may run until it is')
    return binding
  }

  return {
    placement,
    snapshot,
    require,
    attaching: (threadId) => attachments.has(threadId),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    install: async <T>(installArgs: {
      threadId: ThreadId
      work: (handle: BirthInstall<Adapters>) => Promise<T>
    }): Promise<T> => {
      const { threadId } = installArgs
      if (!freezes.has(threadId)) await holdFreeze(threadId)
      let prepared: RuntimeBinding<Adapters> | undefined
      const discard = (): void => {
        const dropped = prepared
        prepared = undefined
        if (dropped !== undefined) dropped.close?.()
      }
      return placement.birth<T>({
        threadId,
        work: async (commit) => {
          const handle: BirthInstall<Adapters> = {
            committed: commit.committed,
            prepareRuntime: (binding) => {
              discard()
              prepared = binding
            },
            commit: async (next) => {
              if (commit.committed()) return
              if (prepared === undefined) {
                throw new Error('a cloud birth needs a prepared runtime before it commits')
              }
              staged = { threadId, binding: prepared }
              try {
                await commit.commit(next)
              } finally {
                if (commit.committed()) prepared = undefined
                staged = undefined
              }
            },
          }
          try {
            return await installArgs.work(handle)
          } finally {
            if (!commit.committed()) {
              discard()
              releaseFreeze(threadId)
            }
          }
        },
      })
    },
    adopt: async ({ threadId, binding }) => {
      if ((await placement.load({ threadId })) === undefined) {
        throw new Error('this session is not placed in a pod or sandbox — a runtime cannot be adopted')
      }
      const prior = cloud
      cloud = { threadId, binding }
      attachments.add(threadId)
      try {
        await holdFreeze(threadId)
        await placement.activate({ threadId })
      } catch (error) {
        if (cloud?.binding === binding) cloud = prior
        try {
          binding.close?.()
        } catch {
          cloud = prior
        }
        throw error
      } finally {
        attachments.delete(threadId)
      }
      if (prior !== undefined && prior.binding !== binding) retiring.push(prior.binding)
      notify()
    },
    detach: ({ threadId }) => {
      if (cloud?.threadId !== threadId) return
      retireCloud()
      notify()
    },
  }
}
