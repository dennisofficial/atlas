import type { ThreadId } from '@dltech/atlas-core'

import { notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { messageOf } from '../error-text'
import type { LiftedAttachment } from '../lifted-session'
import type { ContainerMoveControl } from '../use-container-move'
import { cloudApp, openCloudConversation } from './cloud-app'
import type { CloudBridge } from './cloud-bridge'
import { createCloudRunner, wakeSandbox } from './cloud-runner'
import { CLOUD_REATTACH_NOTICE_KEY, reattachNotice } from './lift-notices'

/**
 * Opening a thread that already lives in the cloud: re-attach (the API re-provisions and hands
 * back a fresh token), wait out a cold pull, then open the conversation against the remote
 * stores. The same attachment a lift ends with, reached from the other side.
 */
export async function openCloudThread(args: {
  app: AtlasApp
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  /** Where this thread lives on this machine, when it does — see cloud-runner.ts's wake. */
  projectDirectory?: string | undefined
}): Promise<LiftedAttachment> {
  const { app, bridge, threadId, move, projectDirectory } = args
  let unready = (): void => undefined

  try {
    const woken = await wakeSandbox({
      bridge,
      threadId,
      ...(move === undefined ? {} : { move }),
      captureContext: () => app.captureContext({ cwd: projectDirectory ?? app.workspace.workspace }),
    })

    const channel = bridge.attach({ threadId, url: woken.url, token: woken.token })

    unready = channel.onReady((ready) => {
      unready()
      notify({
        key: CLOUD_REATTACH_NOTICE_KEY,
        text: reattachNotice({ created: woken.created, turnInFlight: ready.turnInFlight }),
      })
    })

    const runner = createCloudRunner({
      bridge,
      channel,
      threadId,
      captureContext: () => app.captureContext({ cwd: projectDirectory ?? app.workspace.workspace }),
      ...(move === undefined ? {} : { move }),
    })
    const attached = cloudApp({ app, bridge, channel, runner })
    const opened = await openCloudConversation({ app: attached, threadId })

    move?.handleSettle()
    return { app: attached, opened, bridge, channel }
  } catch (error) {
    unready()
    move?.handleFail(messageOf(error))
    throw error
  }
}
