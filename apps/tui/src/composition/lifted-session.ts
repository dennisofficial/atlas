import type { AtlasApp } from './compose'
import type { CloudBridge, CloudChannel, CloudStores } from '@dltech/atlas-harness'
import type { CloudSession } from './cloud/cloud-session'
import type { OpenedConversation } from './open-conversation'

/** What a finished lift hands back: the same app reading the cloud, and the socket it reads over. */
export type LiftedAttachment = {
  app: AtlasApp
  opened: OpenedConversation
  bridge: CloudBridge
  channel: CloudChannel
  stores: CloudStores
}

/** A lifted attachment once the surface has taken ownership of its connection. */
export type LiftedSession = LiftedAttachment & {
  session: CloudSession
  reloads: number
}
