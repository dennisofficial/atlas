import { useSyncExternalStore } from 'react'

import type { OwnerSnapshot, SessionRuntime } from '@dltech/atlas-harness'

import type { AtlasApp } from './compose'

export function useSessionOwner(args: { app: Pick<AtlasApp, 'sessionOwner'> }): OwnerSnapshot<SessionRuntime> {
  const { owner } = { owner: args.app.sessionOwner }
  return useSyncExternalStore(owner.subscribe, owner.snapshot)
}
