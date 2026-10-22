import { EExecutionLocation, locationOfPlacement, type ThreadId } from '@dltech/atlas-core'

import type { PlacementController } from './placement-controller'
import { createSessionFreezes } from './session-freezes'
import { createRetirementQueue } from './session-retirement'
import {
  ERuntimeKind,
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

type Staged<Adapters> = {
  threadId: ThreadId
  target: EExecutionLocation
  binding: RuntimeBinding<Adapters> | undefined
}

const kindFits = (args: { target: EExecutionLocation; kind: ERuntimeKind }): boolean =>
  (args.target === EExecutionLocation.Cloud) === (args.kind === ERuntimeKind.Cloud)

export function createSessionOwner<Adapters>(args: {
  placement: PlacementController
  local: RuntimeBinding<Adapters>
}): SessionOwner<Adapters> {
  const { placement } = args
  const listeners = new Set<() => void>()
  let local = args.local
  const baseFreeze = args.local.freeze
  let cloud: { threadId: ThreadId; binding: RuntimeBinding<Adapters> } | undefined
  let staged: Staged<Adapters> | undefined
  const freezes = createSessionFreezes()
  const attachments = new Set<ThreadId>()

  const releaseFreeze = (threadId: ThreadId): void => freezes.release(threadId)

  const holdFreeze = (threadId: ThreadId): Promise<void> =>
    freezes.hold({
      threadId,
      freeze: (cloud?.threadId === threadId ? cloud.binding : local).freeze ?? baseFreeze,
    })

  const retiring = createRetirementQueue<RuntimeBinding<Adapters>>()

  const notify = (): void => {
    retiring.flush()
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
      }
    }
  }

  const retireCloud = (): void => {
    const retired = cloud
    cloud = undefined
    if (retired !== undefined) retiring.push(retired.binding)
  }

  const install = (held: Staged<Adapters>): void => {
    if (held.target === EExecutionLocation.Cloud) {
      if (held.binding === undefined) return
      if (cloud !== undefined && cloud.binding !== held.binding) retireCloud()
      cloud = { threadId: held.threadId, binding: held.binding }
      return
    }
    if (held.binding !== undefined) local = held.binding
    retireCloud()
    releaseFreeze(held.threadId)
  }

  // A committed cloud birth publishes its placement; the staged binding rides that publish so the
  // durable write and the runtime install land together.
  placement.beforePublish(({ threadId, record }) => {
    const location = locationOfPlacement(record.placement)
    if (staged !== undefined && staged.threadId === threadId && staged.target === location) {
      const held = staged
      staged = undefined
      install(held)
      return
    }
    if (location !== EExecutionLocation.Cloud && cloud?.threadId === threadId) retireCloud()
  })
  placement.subscribe(notify)

  let cached: OwnerSnapshot<Adapters> | undefined

  const snapshot = (): OwnerSnapshot<Adapters> => {
    const threadId = placement.activeThread()
    const location = placement.current()
    const record = threadId === undefined ? undefined : placement.snapshot(threadId)
    const attached =
      location === EExecutionLocation.Cloud && cloud !== undefined && cloud.threadId === threadId
    const binding =
      location !== EExecutionLocation.Cloud ? local : attached ? cloud?.binding : undefined
    const bound = binding !== undefined
    if (
      cached !== undefined &&
      cached.threadId === threadId &&
      cached.location === location &&
      cached.record === record &&
      cached.binding === binding &&
      cached.bound === bound
    ) {
      return cached
    }
    cached = { threadId, location, record, binding, cwd: (binding ?? local).cwd, bound }
    return cached
  }

  const require = (): RuntimeBinding<Adapters> => {
    const view = snapshot()
    if (view.binding === undefined)
      throw new Error('the cloud runtime is not attached — nothing may run until it is')
    return view.binding
  }

  return {
    placement,
    snapshot,
    require,
    attaching: (threadId) => attachments.has(threadId),
    current: placement.current,
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
              if (!kindFits({ target: EExecutionLocation.Cloud, kind: binding.kind })) {
                throw new Error('the prepared runtime does not fit a cloud birth')
              }
              discard()
              prepared = binding
            },
            commit: async (next) => {
              if (commit.committed()) return
              if (prepared === undefined) {
                throw new Error('a cloud birth needs a prepared runtime before it commits')
              }
              staged = { threadId, target: EExecutionLocation.Cloud, binding: prepared }
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
      const record = await placement.load({ threadId })
      if (locationOfPlacement(record.placement) !== EExecutionLocation.Cloud) {
        throw new Error('this session is not in the cloud — a cloud runtime cannot be adopted')
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
    activateLocal: async ({ threadId, binding, fallback }) => {
      await placement.activate({ threadId, fallback })
      if (binding !== undefined) local = binding
      if (cloud?.threadId === threadId && placement.of(threadId) !== EExecutionLocation.Cloud)
        retireCloud()
      if (placement.of(threadId) !== EExecutionLocation.Cloud) releaseFreeze(threadId)
      notify()
    },
    detach: ({ threadId }) => {
      if (cloud?.threadId !== threadId) return
      retireCloud()
      notify()
    },
  }
}
