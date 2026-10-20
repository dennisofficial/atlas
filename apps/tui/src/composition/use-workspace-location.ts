import { useCallback } from 'react'

import { EExecutionLocation } from '@dltech/atlas-core'

import { currentLocationNotice, resourcesConnectingNotice, resourcesRefusalNotice } from './container-notices'
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
    (): string | undefined => currentLocationNotice(execution.location),
    [execution.location],
  )

  const handleContainerResources = useCallback((): string | undefined => {
    if (execution.location !== EExecutionLocation.Cloud) {
      return resourcesRefusalNotice(execution.location)
    }
    if (!execution.bound) return resourcesConnectingNotice
    containerResources.handleOpen()
    return undefined
  }, [containerResources, execution])

  return { handleContainer, handleContainerResources }
}
