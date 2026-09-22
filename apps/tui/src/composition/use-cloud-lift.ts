import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { storedModel } from '@dltech/atlas-harness'
import { useCallback, useRef } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { cloudApp, openCloudConversation } from './cloud/cloud-app'
import type { CloudBridge, LiftedWorkspace } from './cloud/cloud-bridge'
import { captureContextArchive } from './cloud/context-archive'
import { createCloudRunner } from './cloud/cloud-runner'
import { liftToCloud } from './cloud/lift'
import { CLOUD_LIFT_NOTICE_KEY, liftFailedNotice } from './cloud/lift-notices'
import { mergeRemoteMemoryBounded } from './cloud/bounded-merge-remote-memory'
import { stopLocalWork } from './cloud/stop-local'
import { cloudLiftPlan } from './container-move'
import type { AtlasApp } from './compose'
import { messageOf } from './error-text'
import type { LiftedAttachment } from './lifted-session'
import type { ContainerMoveControl } from './use-container-move'

const NOT_SIGNED_IN =
  'moving to the cloud needs an Atlas Cloud sign-in — press ctrl+a or run /auth, then try again'

export type CloudBridgeFactory = (args: { url: string; token: string }) => CloudBridge

export type WorkspaceCapture = (args: { cwd: string }) => Promise<LiftedWorkspace | null>

export type CloudLiftControl = { handleLift: () => void }

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
  capture: WorkspaceCapture
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
    const bridge = createBridge({ url: signedIn.url, token: signedIn.token })
    const { move } = latest.current
    move.handleBegin({ target: EExecutionLocation.Cloud, plan: cloudLiftPlan({ midTurn }) })

    void mergeRemoteMemoryBounded({ session: signedIn, cwd: latest.current.projectDirectory })

    void liftToCloud({
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
      captureContext: () => captureContextArchive({ cwd: latest.current.projectDirectory }),
    })
      .then(async (lifted) => {
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

        const runner = createCloudRunner({ bridge, channel: lifted.channel, threadId, move })
        const attached = cloudApp({ app, bridge, channel: lifted.channel, runner })
        const opened = await openCloudConversation({ app: attached, threadId })
        const arrived = lifted.resumeOnArrival ? { ...opened, resumeOnArrival: true } : opened

        move.handleSettle()
        onLifted({ app: attached, opened: arrived, bridge, channel: lifted.channel })
      })
      .catch((error: unknown) => {
        const reason = `moving to the cloud failed — ${messageOf(error)}`
        move.handleFail(reason)
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
