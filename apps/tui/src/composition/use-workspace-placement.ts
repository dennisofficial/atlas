import type { CloudReload } from '@dltech/atlas-harness'
import type { PodSession } from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'
import { useCloudConnection } from './use-cloud-connection'
import { useContainerPill } from './use-container-pill'
import type { Conversation } from './use-conversation'
import { useExecutionLocation } from './use-execution-location'
import type { CloudBridgeFactory } from './cloud/bridge-factory'
import type { OpenedConversation } from './open-conversation'
import { useLocationItems } from './use-location-items'

export function useWorkspacePlacement(args: {
  app: AtlasApp
  localApp: AtlasApp
  opened: OpenedConversation
  createBridge: CloudBridgeFactory
  onReload: (reload: CloudReload) => Promise<void>
  cloudSession: PodSession | null
  conversation: Pick<Conversation, 'threadId' | 'executionLocation'>
}) {
  const { app, cloudSession, conversation } = args

  const execution = useExecutionLocation({
    app,
    threadId: conversation.threadId,
    stored: conversation.executionLocation,
    started: args.opened.started,
  })
  const cloudConnection = useCloudConnection({ app, session: cloudSession })
  const containerPill = useContainerPill({ app, connection: cloudConnection })
  const locationItems = useLocationItems({ app, connection: cloudConnection })

  return { execution, containerPill, locationItems }
}
