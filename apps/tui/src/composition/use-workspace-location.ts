import { useCallback } from 'react'

import { currentLocationNotice, resourcesConnectingNotice, resourcesUnplacedNotice } from './container-notices'
import type { ContainerResourcesControl } from './use-container-resources'
import type { useExecutionLocation } from './use-execution-location'

export type WorkspaceLocation = {
  handleContainer: () => string | undefined
  handleContainerResources: () => string | undefined
}

export function useWorkspaceLocation(args: {
  execution: ReturnType<typeof useExecutionLocation>
  containerResources: ContainerResourcesControl
}): WorkspaceLocation {
  const { execution, containerResources } = args

  const handleContainer = useCallback(
    (): string | undefined => currentLocationNotice(execution.placed),
    [execution.placed],
  )

  const handleContainerResources = useCallback((): string | undefined => {
    if (!execution.placed) return resourcesUnplacedNotice
    if (!execution.bound) return resourcesConnectingNotice
    containerResources.handleOpen()
    return undefined
  }, [containerResources, execution])

  return { handleContainer, handleContainerResources }
}
