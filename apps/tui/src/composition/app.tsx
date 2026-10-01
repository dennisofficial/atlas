import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ThreadId } from '@dltech/atlas-core'
import type { CaptureContext } from '@dltech/atlas-harness'

import { readClipboardImage, type ClipboardImageReader } from '../ui/clipboard-image'
import { createKeyRegistry, KeyRegistryContext } from '../ui/keys'
import { captureWorkspace } from './cloud/workspace-snapshot'
import { createCloudSession } from './cloud/cloud-session'
import { openCloudConversation } from './cloud/cloud-app'
import { mirrorCloudRenames } from './cloud/rename-mirror'
import type { AtlasApp } from './compose'
import type { LiftedAttachment, LiftedSession } from './lifted-session'
import { liveBridgeFor, liveLiftPreflightFor } from './live-cloud'
import type { OpenedConversation } from './open-conversation'
import type { CloudBridgeFactory, LiftPreflight, WorkspaceCapture } from './use-cloud-lift'
import type { MoveStepTiming } from './use-container-move'
import { Workspace } from './workspace'
import { LIVE_WHATS_NEW_DEPS, useWhatsNew, type WhatsNewDeps } from './use-whats-new'

export { cloudEnvironmentOf, reapExpiredSandboxesOnBoot, telemetryEnvironmentOf } from './live-cloud'

type DraftReader = () => { threadId: ThreadId; text: string }

export function App(props: {
  app: AtlasApp
  opened: OpenedConversation
  credentialNotice?: string | null
  covered?: boolean
  clipboard?: ClipboardImageReader
  onRestart?: () => void
  createBridge?: CloudBridgeFactory
  preflightLift?: LiftPreflight
  captureWorkspace?: WorkspaceCapture
  captureContext?: CaptureContext
  onMoveStep?: ((timing: MoveStepTiming) => void) | undefined
  reapOnBoot?: ((app: AtlasApp) => void) | undefined
  whatsNewDeps?: WhatsNewDeps | undefined
}): React.ReactNode {
  const whatsNew = useWhatsNew({ deps: props.whatsNewDeps ?? LIVE_WHATS_NEW_DEPS })
  const registry = useMemo(() => createKeyRegistry(), [])
  const [lifted, setLifted] = useState<LiftedSession | null>(null)
  const [reopened, setReopened] = useState<OpenedConversation | null>(null)
  const held = useRef<LiftedSession | null>(null)
  held.current = lifted

  const reaped = useRef(false)
  useEffect(() => {
    if (reaped.current) return
    reaped.current = true
    props.reapOnBoot?.(props.app)
  }, [props.app, props.reapOnBoot])

  const reloading = useRef(false)
  const reloadPending = useRef(false)

  const draftReader = useRef<DraftReader | null>(null)
  const handleDraftSource = useCallback((reader: DraftReader | null) => {
    draftReader.current = reader
  }, [])

  const handleReload = useCallback(() => {
    const attached = held.current
    if (attached === null) return
    if (reloading.current) {
      reloadPending.current = true
      return
    }

    reloading.current = true
    void openCloudConversation({
      app: attached.app,
      threadId: attached.opened.threadId,
    })
      .then((opened) =>
        setLifted((current) =>
          current === null ? current : { ...current, opened, reloads: current.reloads + 1 },
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        reloading.current = false
        if (!reloadPending.current) return
        reloadPending.current = false
        handleReload()
      })
  }, [])

  const handleLifted = useCallback(
    (attachment: LiftedAttachment) => {
      held.current?.session.close()

      setLifted({
        ...attachment,
        session: createCloudSession({
          channel: attachment.channel,
          sandboxes: attachment.bridge.sandboxes,
          onReload: handleReload,
          onClose: mirrorCloudRenames({
            home: props.app.threads,
            remote: attachment.stores.threads,
          }),
        }),
        reloads: 0,
      })
    },
    [handleReload, props.app],
  )

  const handleDescend = useCallback((opened: OpenedConversation) => {
    held.current?.session.close()
    setLifted(null)
    setReopened(opened)
  }, [])

  const openedFor = lifted?.opened ?? reopened ?? props.opened
  const carried = draftReader.current?.()

  return (
    <KeyRegistryContext.Provider value={registry}>
      <Workspace
        key={
          lifted === null
            ? `local:${reopened?.threadId ?? 'boot'}`
            : `cloud:${lifted.opened.threadId}:${lifted.reloads}`
        }
        app={lifted?.app ?? props.app}
        localApp={props.app}
        opened={openedFor}
        whatsNew={whatsNew}
        draftText={carried !== undefined && carried.threadId === openedFor.threadId ? carried.text : ''}
        onDraftSource={handleDraftSource}
        cloudSession={lifted?.session ?? null}
        cloudBridge={lifted?.bridge ?? null}
        cloudStores={lifted?.stores ?? null}
        createBridge={props.createBridge ?? liveBridgeFor(props.app)}
        preflightLift={props.preflightLift ?? liveLiftPreflightFor(props.app)}
        captureWorkspace={props.captureWorkspace ?? captureWorkspace}
        captureContext={props.captureContext}
        onLifted={handleLifted}
        onDescend={handleDescend}
        onMoveStep={props.onMoveStep}
        credentialNotice={props.credentialNotice ?? null}
        covered={props.covered === true}
        clipboard={props.clipboard ?? readClipboardImage}
        onRestart={props.onRestart ?? null}
      />
    </KeyRegistryContext.Provider>
  )
}
