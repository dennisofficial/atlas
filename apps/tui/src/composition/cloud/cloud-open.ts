import type { ThreadId } from '@dltech/atlas-core'
import type { CloudReload } from '@dltech/atlas-harness'

import { notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import { messageOf } from '../error-text'
import { cloudAnchorOf, cloudBindingOf, type Binding } from '../session-binding'
import { cloudReadinessOf } from './cloud-readiness'
import { createCloudSession } from './cloud-session'
import { mirrorCloudRenames } from './rename-mirror'
import type { ContainerMoveControl } from '../use-container-move'
import { cloudRuntimeParts, openCloudConversation } from './cloud-app'
import type { CloudBridge } from '@dltech/atlas-harness'
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
  onReload: (reload: CloudReload) => Promise<void>
}): Promise<Binding> {
  const { app, bridge, threadId, move, projectDirectory } = args
  let unready = (): void => undefined

  try {
    const woken = await wakeSandbox({
      bridge,
      threadId,
      ...(move === undefined ? {} : { move }),
      captureContext: () => app.captureContext({ cwd: projectDirectory ?? app.workspace.workspace }),
    })

    const attachment = bridge.attach({ threadId, url: woken.url, token: woken.token })
    const { channel, stores } = attachment

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
    const opened = await openCloudConversation({
      app: { ...app, ...cloudRuntimeParts({ channel, stores, runner }) },
      threadId,
    })
    const anchor = await cloudAnchorOf({ stores, threadId, opened })
    const stopMirroring = mirrorCloudRenames({ home: app.threads, remote: stores.threads })
    const session = createCloudSession({
      channel,
      sandboxes: bridge.sandboxes,
      onReload: args.onReload,
      appliedSnapshot: () => cloudReadinessOf(channel).applied(),
      subscribeApplied: (listener) => cloudReadinessOf(channel).subscribe(listener),
      onClose: () => {
        cloudReadinessOf(channel).cancelWaiting()
        stopMirroring()
      },
    })

    move?.handleSettle()
    return cloudBindingOf({ local: app, anchor, channel, stores, bridge, runner, opened, session })
  } catch (error) {
    unready()
    move?.handleFail(messageOf(error))
    throw error
  }
}
