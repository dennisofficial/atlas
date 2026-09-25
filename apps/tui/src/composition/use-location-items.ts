import { useMemo, useSyncExternalStore } from 'react'

import { cloudConnectionItemOf, isAttaching } from '../ui/cloud-connection-item'
import type { FooterItem } from '../ui/footer-item'
import { useShimmerClock } from '../ui/hooks/use-shimmer-clock'
import { locationPillOf } from '../ui/location-pill'
import { SPINNER_FRAME_MS } from '../ui/theme'
import type { CloudConnection } from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'

export function useLocationItems(args: {
  app: AtlasApp
  connection?: CloudConnection | null | undefined
}): readonly FooterItem[] {
  const location = useSyncExternalStore(
    args.app.executionLocation.subscribe,
    args.app.executionLocation.current,
  )
  const connection = args.connection ?? null
  const now = useShimmerClock({
    active: connection !== null && isAttaching(connection.state),
    intervalMs: SPINNER_FRAME_MS,
  })

  return useMemo(() => {
    const icon = cloudConnectionItemOf({ connection, now })
    const pill = locationPillOf({ location })
    return [icon, pill].filter((item): item is FooterItem => item !== null)
  }, [location, connection, now])
}
