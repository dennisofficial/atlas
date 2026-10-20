import { useMemo } from 'react'

import type { CloudConnection } from '@dltech/atlas-harness'

import { cloudPillOf, type SidebarCloud } from '../store/cloud-state'

export type ContainerPills = {
  cloud: SidebarCloud | null
}

export function useContainerPill(args: {
  connection?: CloudConnection | null | undefined
}): ContainerPills {
  const connection = args.connection ?? null

  return useMemo(() => ({ cloud: cloudPillOf({ connection }) }), [connection])
}
