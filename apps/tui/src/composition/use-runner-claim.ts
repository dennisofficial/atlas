import { RemoteTurnRunner } from '@dltech/atlas-harness'
import { useCallback, useSyncExternalStore } from 'react'

import type { AtlasApp } from './compose'

const NO_UNSUBSCRIBE = (): void => undefined

export const runnerClaimed = (app: Pick<AtlasApp, 'runner'>): boolean =>
  app.runner instanceof RemoteTurnRunner && app.runner.turnInFlight()

export function useRunnerClaim(app: Pick<AtlasApp, 'runner'>): boolean {
  const { runner } = app
  const subscribe = useCallback(
    (listener: () => void): (() => void) =>
      runner instanceof RemoteTurnRunner ? runner.onTurnClaimChanged(listener) : NO_UNSUBSCRIBE,
    [runner],
  )
  const read = useCallback((): boolean => runnerClaimed({ runner }), [runner])
  return useSyncExternalStore(subscribe, read)
}
