import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'

import type { AtlasApp } from '../compose'
import { WAKE_HEADING, WAKE_PLAN } from '../container-move'
import type { LiftedAttachment } from '../lifted-session'
import type { ContainerMoveControl } from '../use-container-move'
import { cloudApp, openCloudConversation } from './cloud-app'
import type { CloudBridge } from './cloud-bridge'
import { createCloudRunner } from './cloud-runner'
import { ELiftStep } from './lift'
import { waitForSandbox } from './wait-for-sandbox'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'the sandbox could not be woken'

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
}): Promise<LiftedAttachment> {
  const { app, bridge, threadId, move } = args

  move?.handleBegin(EExecutionLocation.Cloud, { plan: WAKE_PLAN, heading: WAKE_HEADING })
  try {
    const woken = await bridge.sandboxes.create({ threadId, workspace: null })
    const ready = await waitForSandbox({ sandboxes: bridge.sandboxes, threadId })
    move?.handleAdvance(ELiftStep.Attaching)

    const channel = bridge.attach({ threadId, url: ready.url, token: woken.token })
    const runner = createCloudRunner({
      bridge,
      channel,
      threadId,
      ...(move === undefined ? {} : { move }),
    })
    const attached = cloudApp({ app, bridge, channel, runner })
    const opened = await openCloudConversation({ app: attached, threadId })

    move?.handleSettle()
    return { app: attached, opened, bridge, channel }
  } catch (error) {
    move?.handleFail(messageOf(error))
    throw error
  }
}
