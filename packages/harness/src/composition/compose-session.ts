import type { MessageIntake } from '../intake'
import type { ThreadStorePort } from '../store/thread-store'
import type { ContributedSurface } from '../plugins/surface'

import { holdFamilyIntake } from './freeze-family'
import type { PlacementController } from './placement-controller'
import { createSessionOwner, type SessionOwner, type SessionRuntime } from './session-owner'

export function unplacedSessionOwner(args: {
  placement: PlacementController
  threads: ThreadStorePort
  intake: MessageIntake | undefined
}): SessionOwner<SessionRuntime> {
  const { placement, threads, intake } = args

  return createSessionOwner<SessionRuntime>({
    placement,
    freeze: ({ threadId }) => holdFamilyIntake({ threadId, threads, intake }),
  })
}

export const asPluginSurfaces = <TPluginSurface>(
  surfaces: readonly ContributedSurface[],
): readonly ContributedSurface<TPluginSurface>[] =>
  surfaces as unknown as readonly ContributedSurface<TPluginSurface>[]
