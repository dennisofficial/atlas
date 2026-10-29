import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { BoundPort } from '@dltech/atlas-harness'

import { cloudPillOf, type SidebarCloud } from '../store/cloud-state'
import { containerPillOf, exposedPortsOf, type SidebarContainer } from '../store/sidebar-model'
import type { CloudConnection } from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'
import { useSessionOwner } from './use-session-owner'

/** At most one of these is ever set: the pill says where the loop runs, and it runs in one place. */
export type ContainerPills = {
  container: SidebarContainer | null
  cloud: SidebarCloud | null
}

const samePorts = (left: readonly BoundPort[], right: readonly BoundPort[]): boolean =>
  left.length === right.length &&
  left.every(
    (one, at) =>
      one.containerPort === right[at]?.containerPort && one.hostPort === right[at]?.hostPort,
  )

function useExposedPorts(args: { services: AtlasApp['services'] }): readonly BoundPort[] {
  const read = useCallback(
    () => exposedPortsOf({ services: args.services.list() }),
    [args.services],
  )
  const [exposed, setExposed] = useState(read)

  useEffect(() => {
    const update = (): void =>
      setExposed((current) => {
        const latest = read()
        return samePorts(current, latest) ? current : latest
      })

    update()
    return args.services.subscribe(update)
  }, [args.services, read])

  return exposed
}

export function useContainerPill(args: {
  app: AtlasApp
  connection?: CloudConnection | null | undefined
}): ContainerPills {
  const { app } = args
  const connection = args.connection ?? null

  const { location } = useSessionOwner({ app })
  const container = useSyncExternalStore(app.containerStatus.subscribe, app.containerStatus.current)
  const exposed = useExposedPorts({ services: app.services })

  return useMemo(
    () => ({
      container: containerPillOf({ location, container, exposed }),
      cloud: cloudPillOf({ connection }),
    }),
    [location, container, exposed, connection],
  )
}
