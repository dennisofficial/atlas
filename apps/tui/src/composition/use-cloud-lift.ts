import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { storedModel, type SessionOwner, type SessionRuntime } from '@dltech/atlas-harness'
import { useCallback, useRef } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import type { CaptureContext } from '@dltech/atlas-harness'

import { cloudRuntimeParts, openCloudConversation } from './cloud/cloud-app'
import { parkHookFor } from './cloud/park-hook'
import { cloudReadinessOf } from './cloud/cloud-readiness'
import { createCloudSession } from './cloud/cloud-session'
import { mirrorCloudRenames } from './cloud/rename-mirror'
import { cloudAnchorOf, cloudBindingOf, prepareOn } from './session-binding'
import type { CloudBridge, CloudReload, LiftedWorkspace, LiftWorkspaceCapture } from '@dltech/atlas-harness'
import { createCloudRunner } from './cloud/cloud-runner'
import { liftToCloud } from '@dltech/atlas-harness'
import { CLOUD_LIFT_NOTICE_KEY, liftFailedNotice } from './cloud/lift-notices'
import { stopLocalWork } from '@dltech/atlas-harness'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import type { ContainerMoveControl } from './use-container-move'

export type CloudBridgeFactory = () => CloudBridge

export type WorkspaceCapture = (args: { cwd: string }) => Promise<LiftedWorkspace | null>

export type CloudLiftControl = { handleLift: () => void }

/**
 * Answers the refusal to show, or null when the lift may proceed. Runs before anything stops or
 * transfers: missing Vercel credentials must fail the moment /container cloud is typed, not four
 * steps in at the sandbox wait. A cloud sign-in is never required — provisioning rides the
 * operator's local Vercel credentials and locally minted serve token.
 */
export type LiftPreflight = () => Promise<string | null>

export function useCloudLift(args: {
  app: AtlasApp
  threadId: ThreadId
  started: boolean
  midTurn: () => boolean
  handleInterrupt: () => void
  handlePause: () => void
  handleResumeSource: () => void
  whenSettled: () => Promise<void>
  projectDirectory: string
  owner: SessionOwner<SessionRuntime>
  createBridge: CloudBridgeFactory
  preflightLift?: LiftPreflight | undefined
  capture: WorkspaceCapture
  captureArchive?: LiftWorkspaceCapture | undefined
  captureContext?: CaptureContext | undefined
  move: ContainerMoveControl
  onReload: (reload: CloudReload) => Promise<void>
}): CloudLiftControl {
  const lifting = useRef(false)
  const latest = useRef(args)
  latest.current = args

  const handleLift = useCallback(() => {
    if (lifting.current) return

    const { app, threadId, createBridge, owner } = latest.current
    const midTurn = latest.current.midTurn()

    lifting.current = true
    void Promise.resolve()
      .then(() => latest.current.preflightLift?.() ?? null)
      .then(async (refusal) => {
        if (refusal !== null) {
          notify({ key: CLOUD_LIFT_NOTICE_KEY, text: refusal, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
          return
        }

        const bridge = createBridge()
        const { move } = latest.current

        const captureContext: CaptureContext = () =>
          latest.current.captureContext?.() ??
          latest.current.app.captureContext({ cwd: latest.current.projectDirectory })

        const lifted = await liftToCloud({
          threadId,
          cwd: latest.current.projectDirectory,
          started: latest.current.started,
          midTurn,
          interrupt: latest.current.handleInterrupt,
          pause: latest.current.handlePause,
          resumeSource: latest.current.handleResumeSource,
          whenSettled: latest.current.whenSettled,
          identity: app.workspace,
          title: null,
          model: storedModel(app.model.choice()),
          bridge,
          localThreads: app.threads,
          localLog: app.log,
          agents: app.agents,
          ids: app.ids,
          placement: owner,
          stopLocal: async () => stopLocalWork({ threadId, shells: app.shells, services: app.services, threads: app.threads }),
          capture: latest.current.capture,
          ...(latest.current.captureArchive === undefined ? {} : { captureWorkspaceArchive: latest.current.captureArchive }),
          onBegin: ({ waves }) =>
            move.handleBegin({
              target: EExecutionLocation.Cloud,
              rows: waves.map((wave) => ({ id: wave.ids[0] ?? wave.label, text: wave.label, nodeIds: wave.ids })),
            }),
          onNodeStart: (nodeId) => move.handleNodeStart(nodeId),
          onNodeDone: (nodeId) => move.handleNodeDone(nodeId),
          onTransferProgress: move.handleTransferProgress,
          onWaveLabel: (nodeId, label) => move.handleRowLabel({ nodeId, text: label }),
          captureContext,
          open: async ({ attachment, transaction, restoredWorkspace }) => {
            const runner = createCloudRunner({ bridge, channel: attachment.channel, threadId, captureContext, move })
            const base = { ...app, ...cloudRuntimeParts({ channel: attachment.channel, stores: attachment.stores, runner }) }
            const opened = await openCloudConversation({ app: base, threadId })
            const anchor = await cloudAnchorOf({ stores: attachment.stores, threadId, opened, restored: restoredWorkspace })
            const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: attachment.stores.threads })
            const session = createCloudSession({
              channel: attachment.channel,
              sandboxes: bridge.sandboxes,
              onReload: latest.current.onReload,
              appliedSnapshot: () => cloudReadinessOf(attachment.channel).applied(),
              subscribeApplied: (listener) => cloudReadinessOf(attachment.channel).subscribe(listener),
              onParked: parkHookFor({ app, channel: attachment.channel }),
              onClose: () => {
                cloudReadinessOf(attachment.channel).cancelWaiting()
                stopMirroring()
              },
            })
            prepareOn({
              transaction,
              binding: cloudBindingOf({
                local: app,
                anchor,
                channel: attachment.channel,
                stores: attachment.stores,
                bridge,
                runner,
                opened: midTurn ? { ...opened, resumeOnArrival: true } : opened,
                session,
              }),
            })
          },
        })

        if (lifted.ok && lifted.warning !== undefined) {
          notify({
            key: CLOUD_LIFT_NOTICE_KEY,
            text: `this conversation is in the cloud, but ${lifted.warning}`,
            tone: ENoticeTone.Warn,
            sticky: true,
          })
        }

        if (!lifted.ok) {
          const reason = liftFailedNotice(lifted)
          move.handleFail(reason)
          notify({ key: CLOUD_LIFT_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
          return
        }

        move.handleSettle()
      })
      .catch((error: unknown) => {
        const reason = `moving to the cloud failed — ${messageOf(error)}`
        latest.current.move.handleFail(reason)
        notify({ key: CLOUD_LIFT_NOTICE_KEY, text: reason, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
      })
      .finally(() => {
        lifting.current = false
      })
  }, [])

  return { handleLift }
}
