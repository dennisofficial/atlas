import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { RemoteTurnRunner } from '@dltech/atlas-harness'

import { WAKE_HEADING, WAKE_PLAN } from '../container-move'
import { messageOf } from '../error-text'
import type { ContainerMoveControl } from '../use-container-move'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { ELiftStep } from './lift'
import { waitForSandbox } from './wait-for-sandbox'

/**
 * Re-attaching to a thread's sandbox: the API re-provisions and hands back a fresh token, then the
 * status route is polled until the sandbox is actually running. Narrated through `move` when one
 * is given, so a wake reached from an idle conversation reads as progress rather than as a stall.
 */
export async function wakeSandbox(args: {
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
}): Promise<{ url: string; token: string }> {
  args.move?.handleBegin({ target: EExecutionLocation.Cloud, plan: WAKE_PLAN, heading: WAKE_HEADING })
  args.move?.handleAdvance(ELiftStep.Starting)

  const woken = await args.bridge.sandboxes.create({
    threadId: args.threadId,
    workspace: null,
  })
  const ready = await waitForSandbox({
    sandboxes: args.bridge.sandboxes,
    threadId: args.threadId,
  })

  args.move?.handleAdvance(ELiftStep.Attaching)
  return { url: ready.url, token: woken.token }
}

export function createCloudRunner(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
}): RemoteTurnRunner {
  const wake = async (): Promise<void> => {
    try {
      const woken = await wakeSandbox({
        bridge: args.bridge,
        threadId: args.threadId,
        ...(args.move === undefined ? {} : { move: args.move }),
      })
      args.channel.wake({ url: woken.url, token: woken.token })
      args.move?.handleSettle()
    } catch (error) {
      args.move?.handleFail(messageOf(error))
      throw error
    }
  }

  return new RemoteTurnRunner({ channel: args.channel, wake })
}
