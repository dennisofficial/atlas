import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { storedModel } from '@dltech/atlas-harness'
import { useCallback, useRef } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { mergeRemoteMemoryBounded, type CaptureContext } from '@dltech/atlas-harness'

import { clientVersionHeader } from '../build/info'
import { cloudApp, openCloudConversation } from './cloud/cloud-app'
import type { CloudBridge, CloudStores, LiftedWorkspace } from '@dltech/atlas-harness'
import { noticePortBinding } from './notice-binding'
import { createCloudRunner } from './cloud/cloud-runner'
import { liftToCloud } from '@dltech/atlas-harness'
import { CLOUD_LIFT_NOTICE_KEY, liftFailedNotice } from './cloud/lift-notices'
import { stopLocalWork } from '@dltech/atlas-harness'
import { cloudLiftPlan } from './container-move'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import type { OpenedConversation } from './open-conversation'
import type { LiftedAttachment } from './lifted-session'
import type { ContainerMoveControl } from './use-container-move'

const NOT_SIGNED_IN =
  'moving to the cloud needs an Atlas Cloud sign-in — settings (ctrl+o) › cloud, then try again'

export type CloudBridgeFactory = (args: { url: string; token: string }) => CloudBridge

export type WorkspaceCapture = (args: { cwd: string }) => Promise<LiftedWorkspace | null>

export type CloudLiftControl = { handleLift: () => void }

/**
 * Answers the refusal to show, or null when the lift may proceed. Runs before anything stops or
 * transfers: a missing Vercel token or gh login must fail the moment /container cloud is typed,
 * not four steps in at the sandbox wait.
 */
export type LiftPreflight = () => Promise<string | null>

export function useCloudLift(args: {
  app: AtlasApp
  threadId: ThreadId
  started: boolean
  midTurn: () => boolean
  handleInterrupt: () => void
  whenSettled: () => Promise<void>
  projectDirectory: string
  setLocation: (location: EExecutionLocation) => void
  createBridge: CloudBridgeFactory
  preflightLift?: LiftPreflight | undefined
  capture: WorkspaceCapture
  captureContext?: CaptureContext | undefined
  move: ContainerMoveControl
  onLifted: (attachment: LiftedAttachment) => void
}): CloudLiftControl {
  const lifting = useRef(false)
  const latest = useRef(args)
  latest.current = args

  const handleLift = useCallback(() => {
    if (lifting.current) return

    const { app, threadId, createBridge, onLifted } = latest.current
    const midTurn = latest.current.midTurn()
    const signedIn = app.cloud.session()
    if (signedIn === null) {
      notify({ key: CLOUD_LIFT_NOTICE_KEY, text: NOT_SIGNED_IN, tone: ENoticeTone.Warn })
      return
    }

    lifting.current = true
    void Promise.resolve()
      .then(() => latest.current.preflightLift?.() ?? null)
      .then(async (refusal) => {
        if (refusal !== null) {
          notify({
            key: CLOUD_LIFT_NOTICE_KEY,
            text: refusal,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
          return
        }

        const bridge = createBridge({ url: signedIn.url, token: signedIn.token })
        const { move } = latest.current
        move.handleBegin({ target: EExecutionLocation.Cloud, plan: cloudLiftPlan({ midTurn }) })

        void mergeRemoteMemoryBounded({
          session: signedIn,
          clientVersion: clientVersionHeader(),
          notice: noticePortBinding(),
          cwd: latest.current.projectDirectory,
        }).catch(() => undefined)

        const captureContext: CaptureContext = () =>
          latest.current.captureContext?.() ??
          latest.current.app.captureContext({ cwd: latest.current.projectDirectory })

        let opened: OpenedConversation | undefined
        let liftedStores: CloudStores | undefined
        const lifted = await liftToCloud({
      threadId,
      cwd: latest.current.projectDirectory,
      started: latest.current.started,
      midTurn,
      interrupt: latest.current.handleInterrupt,
      whenSettled: latest.current.whenSettled,
      identity: app.workspace,
      title: null,
      model: storedModel(app.model.choice()),
      bridge,
      localThreads: app.threads,
      localLog: app.log,
      agents: app.agents,
      ids: app.ids,
      setLocation: latest.current.setLocation,
      stopLocal: async () =>
        stopLocalWork({ threadId, shells: app.shells, services: app.services }),
      capture: latest.current.capture,
      onProgress: (step) => move.handleAdvance(step),
      captureContext,
      open: async (attachment) => {
        liftedStores = attachment.stores
        const runner = createCloudRunner({
          bridge,
          channel: attachment.channel,
          threadId,
          captureContext,
          move,
        })
        const attached = cloudApp({ app, channel: attachment.channel, stores: attachment.stores, runner })
        opened = await openCloudConversation({ app: attached, threadId })
      },
    })

        if (!lifted.ok) {
          const reason = liftFailedNotice(lifted)
          move.handleFail(reason)
          notify({
            key: CLOUD_LIFT_NOTICE_KEY,
            text: reason,
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
          return
        }

        const runner = createCloudRunner({ bridge, channel: lifted.channel, threadId, captureContext, move })
        if (liftedStores === undefined) throw new Error('the lift attached without its stores')
        const attached = cloudApp({ app, channel: lifted.channel, stores: liftedStores, runner })
        const conversation = opened ?? (await openCloudConversation({ app: attached, threadId }))
        const arrived = lifted.resumeOnArrival
          ? { ...conversation, resumeOnArrival: true }
          : conversation

        move.handleSettle()
        onLifted({ app: attached, opened: arrived, bridge, channel: lifted.channel, stores: liftedStores })
      })
      .catch((error: unknown) => {
        const reason = `moving to the cloud failed — ${messageOf(error)}`
        latest.current.move.handleFail(reason)
        notify({
          key: CLOUD_LIFT_NOTICE_KEY,
          text: reason,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
      })
      .finally(() => {
        lifting.current = false
      })
  }, [])

  return { handleLift }
}
