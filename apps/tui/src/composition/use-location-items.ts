import { useMemo, useSyncExternalStore } from 'react'

import { isTransitioning } from '@dltech/atlas-harness'

import { cloudConnectionItemOf } from '../ui/cloud-connection-item'
import type { FooterItem } from '../ui/footer-item'
import { useShimmerClock } from '../ui/hooks/use-shimmer-clock'
import { locationPillOf } from '../ui/location-pill'
import { SPINNER_FRAME_MS } from '../ui/theme'
import type { CloudConnection } from '@dltech/atlas-harness'
import { bornPlacementChip } from './cloud/born-placement-chip'
import type { AtlasApp } from './compose'
import { useSessionOwner } from './use-session-owner'

export function useLocationItems(args: {
  app: AtlasApp
  connection?: CloudConnection | null | undefined
}): readonly FooterItem[] {
  const { location, threadId } = useSessionOwner({ app: args.app })
  const connection = args.connection ?? null
  const chip = bornPlacementChip(args.app)
  const unplaced = useSyncExternalStore(chip.subscribe, chip.snapshot)
  const now = useShimmerClock({
    active: connection !== null && isTransitioning(connection.state),
    intervalMs: SPINNER_FRAME_MS,
  })

  return useMemo(() => {
    const icon = cloudConnectionItemOf({ connection, now })
    const placement =
      unplaced === null || unplaced.threadId !== threadId
        ? null
        : {
            harness: unplaced.harness,
            runner: unplaced.runner,
            provisioning: unplaced.provisioning,
            onFlip: args.app.pods && unplaced.preference === true ? chip.flip : undefined,
          }
    const pill = locationPillOf({ location, placement })
    return [icon, pill].filter((item): item is FooterItem => item !== null)
  }, [location, threadId, connection, now, unplaced, chip])
}
