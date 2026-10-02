import {
  EExecutionLocation,
  EPlacementMovePhase,
  locationOfPlacement,
  type PlacementRecord,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PlacementController } from './placement-controller'
import { createSessionFreezes } from './session-freezes'
import { recoveryActionOf } from './session-recovery'
import {
  ERuntimeKind,
  type OwnerSnapshot,
  type RuntimeBinding,
  type SessionOwner,
} from './session-owner-types'

export { ERuntimeKind } from './session-owner-types'
export type {
  OwnerSnapshot,
  OwnerTransaction,
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
    freezes.hold({ threadId, freeze: (cloud?.threadId === threadId ? cloud.binding : local).freeze ?? baseFreeze })

  const retiring: RuntimeBinding<Adapters>[] = []

  const flushRetired = (): void => {
    for (const binding of retiring.splice(0)) {
      try {
        binding.close?.()
      } catch {
        continue
      }
    }
  }

  const notify = (): void => {
    flushRetired()
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

  placement.beforePublish(({ threadId, record }) => {
    const location = locationOfPlacement(record.placement)
    const committed = record.move?.phase === EPlacementMovePhase.Committed
    if (staged !== undefined && staged.threadId === threadId && committed && staged.target === location) {
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
    const attached = location === EExecutionLocation.Cloud && cloud !== undefined && cloud.threadId === threadId
    const binding = location !== EExecutionLocation.Cloud ? local : attached ? cloud?.binding : undefined
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
    if (view.binding === undefined) throw new Error('the cloud runtime is not attached — nothing may run until it is')
    return view.binding
  }

  const move: SessionOwner<Adapters>['move'] = async (moveArgs) => {
    let prepared: RuntimeBinding<Adapters> | undefined
    let committed = false
    let froze = false
    const discard = (): void => {
      const dropped = prepared
      prepared = undefined
      if (dropped !== undefined && dropped !== local) dropped.close?.()
    }
    try {
      return await placement.move({
        threadId: moveArgs.threadId,
        target: moveArgs.target,
        kind: moveArgs.kind,
        work: async (transaction) => {
          if (moveArgs.target === EExecutionLocation.Cloud && !freezes.has(moveArgs.threadId)) {
            await holdFreeze(moveArgs.threadId)
            froze = true
          }
          return moveArgs.work({
            ...transaction,
            prepareRuntime: (binding) => {
              discard()
              prepared = binding
            },
            commit: async (placementArg) => {
              if (committed) return
              if (prepared === undefined && moveArgs.target === EExecutionLocation.Cloud) {
                throw new Error('a cloud move needs a prepared runtime before it commits')
              }
              if (prepared !== undefined && !kindFits({ target: moveArgs.target, kind: prepared.kind })) {
                throw new Error('the prepared runtime does not fit the move target')
              }
              staged = { threadId: moveArgs.threadId, target: moveArgs.target, binding: prepared }
              try {
                await transaction.commit(placementArg)
              } finally {
                if (transaction.committed()) {
                  committed = true
                  prepared = undefined
                }
                staged = undefined
              }
            },
          })
        },
      })
    } finally {
      staged = undefined
      if (!committed) {
        discard()
        if (froze) releaseFreeze(moveArgs.threadId)
      }
    }
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
    move,
    adopt: async ({ threadId, binding, settle }) => {
      const record = await placement.load({ threadId })
      if (locationOfPlacement(record.placement) !== EExecutionLocation.Cloud) {
        throw new Error('this session is not in the cloud — a cloud runtime cannot be adopted')
      }
      if (record.move !== null && settle === undefined) {
        throw new Error('this session has an unfinished move — recover it before attaching')
      }
      const prior = cloud
      cloud = { threadId, binding }
      attachments.add(threadId)
      try {
        await holdFreeze(threadId)
        await placement.activate({ threadId })
        if (record.move !== null && settle !== undefined) {
          await settle({ record, action: recoveryActionOf(record) })
          await placement.recover({ threadId, reconcile: async (held) => held.placement })
        }
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
      if (cloud?.threadId === threadId && placement.of(threadId) !== EExecutionLocation.Cloud) retireCloud()
      if (placement.of(threadId) !== EExecutionLocation.Cloud) releaseFreeze(threadId)
      notify()
    },
    recover: async ({ threadId, prepare }) => {
      const priorCloud = cloud
      const priorLocal = local
      let installed: RuntimeBinding<Adapters> | undefined
      try {
        const settled = await placement.recover({
          threadId,
          reconcile: async (record) => {
            const target = locationOfPlacement(record.placement)
            const action = recoveryActionOf(record)
            if (target === EExecutionLocation.Cloud) {
              if (prepare === undefined) throw new Error('the cloud runtime could not be prepared — the move stays unfinished')
              const prepared = await prepare({ record, action })
              installed = prepared
              if (prepared.kind !== ERuntimeKind.Cloud) throw new Error('the prepared runtime does not fit the move target')
              cloud = { threadId, binding: prepared }
              await holdFreeze(threadId)
              return record.placement
            }
            if (prepare !== undefined) {
              const prepared = await prepare({ record, action })
              installed = prepared
              if (prepared.kind !== ERuntimeKind.Local) throw new Error('the prepared runtime does not fit the move target')
              local = prepared
            }
            return record.placement
          },
        })
        if (priorCloud !== undefined && priorCloud.binding !== cloud?.binding) retiring.push(priorCloud.binding)
        if (locationOfPlacement(settled.placement) !== EExecutionLocation.Cloud) releaseFreeze(threadId)
        notify()
        return settled
      } catch (error) {
        cloud = priorCloud
        local = priorLocal
        if (installed !== undefined && installed !== priorCloud?.binding && installed !== priorLocal) {
          try {
            installed.close?.()
          } catch {
            installed = undefined
          }
        }
        throw error
      }
    },
    detach: ({ threadId }) => {
      if (cloud?.threadId !== threadId) return
      retireCloud()
      notify()
    },
  }
}
