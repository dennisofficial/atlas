import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import { useCloudConnection } from './use-cloud-connection'
import { useContainerPill } from './use-container-pill'
import type { Conversation } from './use-conversation'
import { useExecutionLocation } from './use-execution-location'
import { useLocationItems } from './use-location-items'

export function useWorkspacePlacement(args: {
  app: AtlasApp
  cloudSession: CloudSession | null
  conversation: Pick<Conversation, 'threadId' | 'executionLocation'>
}) {
  const { app, cloudSession, conversation } = args

  const execution = useExecutionLocation({
    app,
    threadId: conversation.threadId,
    stored: conversation.executionLocation,
  })
  const cloudConnection = useCloudConnection({ app, session: cloudSession })
  const containerPill = useContainerPill({ app, connection: cloudConnection })
  const locationItems = useLocationItems({ app, connection: cloudConnection })

  return { execution, containerPill, locationItems }
}
