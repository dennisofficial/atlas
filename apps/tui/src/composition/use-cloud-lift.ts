import { EExecutionLocation, type Event, type ThreadId } from '@dltech/atlas-core'
import { useCallback, useRef } from 'react'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../ui/notice-store'
import { cloudApp, openCloudConversation } from './cloud/cloud-app'
import type { CloudBridge, LiftedWorkspace } from './cloud/cloud-bridge'
import { ELiftStep, liftToCloud } from './cloud/lift'
import {
  CLOUD_LIFT_NOTICE_KEY,
  liftedNotice,
  liftFailedNotice,
  liftProgressNotice,
} from './cloud/lift-notices'
import { stopLocalWork } from './cloud/stop-local'
import type { AtlasApp } from './compose'
import type { LiftedAttachment } from './lifted-session'

const NOT_SIGNED_IN =
  'moving to the cloud needs an Atlas Cloud sign-in — press ctrl+a or run /auth, then try again'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export type CloudBridgeFactory = (args: { url: string; token: string }) => CloudBridge

export type WorkspaceCapture = (args: { cwd: string }) => Promise<LiftedWorkspace | null>

export type CloudLiftControl = { handleLift: () => void }

export function useCloudLift(args: {
  app: AtlasApp
  threadId: ThreadId
  started: boolean
  projectDirectory: string
  readEvents: () => readonly Event[]
  setLocation: (location: EExecutionLocation) => void
  createBridge: CloudBridgeFactory
  capture: WorkspaceCapture
  onLifted: (attachment: LiftedAttachment) => void
}): CloudLiftControl {
  const lifting = useRef(false)
  const latest = useRef(args)
  latest.current = args

  const handleLift = useCallback(() => {
    if (lifting.current) return

    const { app, threadId, createBridge, onLifted } = latest.current
    const signedIn = app.cloud.session()
    if (signedIn === null) {
      notify({ key: CLOUD_LIFT_NOTICE_KEY, text: NOT_SIGNED_IN, tone: ENoticeTone.Warn })
      return
    }

    lifting.current = true
    const bridge = createBridge({ url: signedIn.url, token: signedIn.token })

    void liftToCloud({
      threadId,
      cwd: latest.current.projectDirectory,
      events: latest.current.readEvents(),
      started: latest.current.started,
      identity: app.workspace,
      title: null,
      bridge,
      localThreads: app.threads,
      ids: app.ids,
      setLocation: latest.current.setLocation,
      stopLocal: async () =>
        stopLocalWork({ threadId, shells: app.shells, services: app.services }),
      capture: latest.current.capture,
      onProgress: (step: ELiftStep) =>
        notify({
          key: CLOUD_LIFT_NOTICE_KEY,
          text: liftProgressNotice(step),
          tone: ENoticeTone.Info,
          sticky: true,
        }),
    })
      .then(async (lifted) => {
        if (!lifted.ok) {
          notify({
            key: CLOUD_LIFT_NOTICE_KEY,
            text: liftFailedNotice(lifted),
            tone: ENoticeTone.Warn,
            ttlMs: NOTICE_WARN_MS,
          })
          return
        }

        const attached = cloudApp({ app, bridge, channel: lifted.channel })
        const opened = await openCloudConversation({ app: attached, threadId })

        notify({ key: CLOUD_LIFT_NOTICE_KEY, text: liftedNotice(lifted), tone: ENoticeTone.Done })
        onLifted({ app: attached, opened, bridge, channel: lifted.channel })
      })
      .catch((error: unknown) => {
        notify({
          key: CLOUD_LIFT_NOTICE_KEY,
          text: `moving to the cloud failed — ${messageOf(error)}`,
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
