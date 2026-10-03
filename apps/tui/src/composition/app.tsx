import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { ThreadId } from '@dltech/atlas-core'
import type { CaptureContext, LiftWorkspaceCapture, WorkspaceRestorer } from '@dltech/atlas-harness'

import { readClipboardImage, type ClipboardImageReader } from '../ui/clipboard-image'
import { createKeyRegistry, KeyRegistryContext } from '../ui/keys'
import { captureWorkspaceMetadata } from '@dltech/atlas-harness'
import { cloudReadinessOf } from './cloud/cloud-readiness'
import { openCloudConversation } from './cloud/cloud-app'
import type { AtlasApp } from './compose'
import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { messageOf } from './error-text'
import { liveBridgeFor, liveLiftPreflightFor } from './live-cloud'
import type { ReloadedSession } from './lifted-session'
import type { OpenedConversation } from './open-conversation'
import { appOf, attachmentOf, cloudAttachmentOf, keyOf, localAnchorOf, localBindingOf } from './session-binding'
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
  captureArchive?: LiftWorkspaceCapture
  restoreWorkspace?: WorkspaceRestorer
  captureContext?: CaptureContext
  onMoveStep?: ((timing: MoveStepTiming) => void) | undefined
  reapOnBoot?: ((app: AtlasApp) => void) | undefined
  whatsNewDeps?: WhatsNewDeps | undefined
}): React.ReactNode {
  const whatsNew = useWhatsNew({ deps: props.whatsNewDeps ?? LIVE_WHATS_NEW_DEPS })
  const registry = useMemo(() => createKeyRegistry(), [])
  const owner = props.app.sessionOwner
  const snapshot = useSyncExternalStore(owner.subscribe, owner.snapshot)
  const [reopened, setReopened] = useState<OpenedConversation | null>(null)
  const [reloaded, setReloaded] = useState<ReloadedSession | null>(null)

  const app = appOf({ local: props.app, binding: snapshot.binding })
  const attachment = attachmentOf(snapshot.binding)
  const cloud = cloudAttachmentOf(snapshot.binding)
  const heldCloud = useRef(cloud)
  heldCloud.current = cloud

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

  const handleReload = useCallback((): Promise<void> => {
    const attached = heldCloud.current
    const current = owner.snapshot().binding
    if (attached === undefined || current === undefined) {
      return Promise.reject(new Error('the cloud attachment is no longer mounted'))
    }
    if (reloading.current) {
      reloadPending.current = true
      return Promise.resolve()
    }

    reloading.current = true
    const task = (async () => {
      const opened = await openCloudConversation({
        app: appOf({ local: props.app, binding: current }),
        threadId: attached.opened.threadId,
      })
      if (owner.snapshot().binding !== current) {
        throw new Error('the cloud attachment changed during transcript synchronization')
      }
      if (opened.identity === undefined) {
        throw new Error('the cloud transcript has no complete snapshot identity')
      }
      const applied = cloudReadinessOf(attached.session.channel).waitUntilApplied(opened.identity)
      setReloaded((prior) => ({
        binding: current,
        opened,
        reloads: prior?.binding === current ? prior.reloads + 1 : 1,
      }))
      await applied
    })()
    return task.finally(() => {
      reloading.current = false
      if (!reloadPending.current) return
      reloadPending.current = false
      void handleReload().catch(() => undefined)
    })
  }, [owner, props.app])

  const handleLocalOpened = useCallback(
    (opened: OpenedConversation, remount: boolean) => {
      const leaving = owner.snapshot().threadId
      if (remount) {
        setReopened(opened)
        setReloaded(null)
      }
      void owner
        .activateLocal({
          threadId: opened.threadId,
          binding: localBindingOf({ local: props.app, workspace: localAnchorOf({ local: props.app, opened }), opened }),
        })
        .catch((error: unknown) => {
          notify({
            key: 'leave-cloud',
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
            text: `this conversation could not be reopened here — ${messageOf(error)}`,
          })
        })
        .finally(() => {
          if (leaving !== undefined && leaving !== opened.threadId) owner.detach({ threadId: leaving })
        })
    },
    [owner, props.app],
  )

  const handleLeaveCloud = useCallback((opened: OpenedConversation) => handleLocalOpened(opened, true), [handleLocalOpened])
  const handleLocalSwap = useCallback((opened: OpenedConversation) => handleLocalOpened(opened, false), [handleLocalOpened])

  const reloadedHere = reloaded !== null && reloaded.binding === snapshot.binding ? reloaded : null
  const cloudOpened = cloud === undefined ? undefined : attachment?.opened
  const localOpened = attachment?.kind === 'local' && attachment.opened.threadId === reopened?.threadId ? attachment.opened : undefined
  const openedFor = reloadedHere?.opened ?? cloudOpened ?? localOpened ?? reopened ?? props.opened
  const carried = draftReader.current?.()

  return (
    <KeyRegistryContext.Provider value={registry}>
      <Workspace
        key={
          cloud === undefined
            ? `local:${reopened?.threadId ?? 'boot'}`
            : `cloud:${cloud.opened.threadId}:${keyOf(snapshot.binding)}:${reloadedHere?.reloads ?? 0}`
        }
        app={app}
        localApp={props.app}
        opened={openedFor}
        attachment={attachment}
        whatsNew={whatsNew}
        draftText={carried !== undefined && carried.threadId === openedFor.threadId ? carried.text : ''}
        onDraftSource={handleDraftSource}
        cloudSession={cloud?.session ?? null}
        cloudBridge={cloud?.bridge ?? null}
        cloudStores={cloud?.stores ?? null}
        createBridge={props.createBridge ?? liveBridgeFor(props.app)}
        preflightLift={props.preflightLift ?? liveLiftPreflightFor(props.app)}
        captureWorkspace={props.captureWorkspace ?? captureWorkspaceMetadata}
        captureArchive={props.captureArchive}
        restoreWorkspace={props.restoreWorkspace}
        captureContext={props.captureContext}
        onReload={handleReload}
        onLeaveCloud={handleLeaveCloud}
        onLocalOpened={handleLocalSwap}
        onMoveStep={props.onMoveStep}
        credentialNotice={props.credentialNotice ?? null}
        covered={props.covered === true}
        clipboard={props.clipboard ?? readClipboardImage}
        onRestart={props.onRestart ?? null}
      />
    </KeyRegistryContext.Provider>
  )
}
