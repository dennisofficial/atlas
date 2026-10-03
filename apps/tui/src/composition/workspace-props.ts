import type { CaptureContext, CloudBridge, CloudReload, CloudStores, LiftWorkspaceCapture, WorkspaceRestorer } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

import type { ClipboardImageReader } from '../ui/clipboard-image'
import type { CloudSession } from './cloud/cloud-session'
import type { AtlasApp } from './compose'
import type { OpenedConversation } from './open-conversation'
import type { SurfaceAttachment } from './session-binding'
import type { CloudBridgeFactory, LiftPreflight, WorkspaceCapture } from './use-cloud-lift'
import type { MoveStepTiming } from './use-container-move'
import type { WhatsNewControl } from './use-whats-new'

export type WorkspaceProps = {
  app: AtlasApp
  localApp: AtlasApp
  opened: OpenedConversation
  attachment: SurfaceAttachment | undefined
  credentialNotice: string | null
  covered: boolean
  whatsNew: WhatsNewControl
  clipboard: ClipboardImageReader
  onRestart: (() => void) | null
  cloudSession: CloudSession | null
  cloudBridge: CloudBridge | null
  cloudStores: CloudStores | null
  createBridge: CloudBridgeFactory
  preflightLift: LiftPreflight
  captureWorkspace: WorkspaceCapture
  captureArchive: LiftWorkspaceCapture | undefined
  restoreWorkspace: WorkspaceRestorer | undefined
  captureContext: CaptureContext | undefined
  onReload: (reload: CloudReload) => Promise<void>
  onLeaveCloud: (opened: OpenedConversation) => void
  onLocalOpened: (opened: OpenedConversation) => void
  draftText: string
  onDraftSource: (reader: (() => { threadId: ThreadId; text: string }) | null) => void
  onMoveStep?: ((timing: MoveStepTiming) => void) | undefined
}
