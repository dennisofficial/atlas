import type { CaptureContext, CloudBridge, CloudStores } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import type { ClipboardImageReader } from '../ui/clipboard-image'
import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import type { LiftedAttachment } from './lifted-session'
import type { OpenedConversation } from './open-conversation'
import type { CloudBridgeFactory, LiftPreflight, WorkspaceCapture } from './use-cloud-lift'
import type { MoveStepTiming } from './use-container-move'

export type WorkspaceProps = {
  app: AtlasApp
  localApp: AtlasApp
  opened: OpenedConversation
  credentialNotice: string | null
  covered: boolean
  clipboard: ClipboardImageReader
  onRestart: (() => void) | null
  cloudSession: CloudSession | null
  cloudBridge: CloudBridge | null
  cloudStores: CloudStores | null
  createBridge: CloudBridgeFactory
  preflightLift: LiftPreflight
  captureWorkspace: WorkspaceCapture
  captureContext: CaptureContext | undefined
  onLifted: (attachment: LiftedAttachment) => void
  onDescend: (opened: OpenedConversation) => void
  draftText: string
  onDraftSource: (reader: (() => { threadId: ThreadId; text: string }) | null) => void
  onMoveStep?: ((timing: MoveStepTiming) => void) | undefined
}
