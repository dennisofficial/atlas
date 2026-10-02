import type { CloudReload } from '@dltech/atlas-harness'
import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import { useCloudConnection } from './use-cloud-connection'
import { useContainerPill } from './use-container-pill'
import type { Conversation } from './use-conversation'
import { useExecutionLocation } from './use-execution-location'
import { useSessionRecovery } from './use-session-recovery'
import type { CloudBridgeFactory } from './use-cloud-lift'
import type { OpenedConversation } from './open-conversation'
import { useLocationItems } from './use-location-items'

export function useWorkspacePlacement(args: {
  app: AtlasApp
  localApp: AtlasApp
  opened: OpenedConversation
  createBridge: CloudBridgeFactory
  onReload: (reload: CloudReload) => Promise<void>
  cloudSession: CloudSession | null
  conversation: Pick<Conversation, 'threadId' | 'executionLocation'>
}) {
  const { app, cloudSession, conversation } = args

  useSessionRecovery({
    localApp: args.localApp,
    threadId: conversation.threadId,
    opened: args.opened,
    createBridge: args.createBridge,
    onReload: args.onReload,
  })

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
