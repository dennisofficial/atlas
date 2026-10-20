import type { CloudReload } from '@dltech/atlas-harness'
import type { CloudSession } from './cloud/cloud-session'
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
  cloudSession: CloudSession | null
  conversation: Pick<Conversation, 'threadId'>
}) {
  const { app, cloudSession, conversation } = args

  const execution = useExecutionLocation({ app, threadId: conversation.threadId })
  const cloudConnection = useCloudConnection({ app, session: cloudSession })
  const containerPill = useContainerPill({ connection: cloudConnection })
  const locationItems = useLocationItems({ app, connection: cloudConnection })

  return { execution, containerPill, locationItems }
}
