import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { RemoteTurnRunner } from '@dltech/atlas-harness'

import { WAKE_HEADING, WAKE_PLAN } from '../container-move'
import type { ContainerMoveControl } from '../use-container-move'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { ELiftStep } from './lift'
import { waitForSandbox } from './wait-for-sandbox'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The wake a `RemoteTurnRunner` calls when the channel is not open: re-provision the sandbox,
 * wait for it to come up, then re-dial the socket with the fresh credentials. Narrated through
 * `move` when one is given, so a wake reached from an idle conversation reads the same as an
 * initial lift rather than as a silent stall.
 */
export function createCloudRunner(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
}): RemoteTurnRunner {
  const wake = async (): Promise<void> => {
    args.move?.handleBegin(EExecutionLocation.Cloud, { plan: WAKE_PLAN, heading: WAKE_HEADING })
    args.move?.handleAdvance(ELiftStep.Starting)

    try {
      const woken = await args.bridge.sandboxes.create({
        threadId: args.threadId,
        workspace: null,
      })
      const ready = await waitForSandbox({
        sandboxes: args.bridge.sandboxes,
        threadId: args.threadId,
      })

      args.move?.handleAdvance(ELiftStep.Attaching)
      args.channel.wake({ url: ready.url, token: woken.token })
      args.move?.handleSettle()
    } catch (error) {
      args.move?.handleFail(messageOf(error))
      throw error
    }
  }

  return new RemoteTurnRunner({ channel: args.channel, wake })
}
