import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { RemoteTurnRunner } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import { WAKE_HEADING, WAKE_PLAN } from '../container-move'
import { messageOf } from '../error-text'
import type { ContainerMoveControl } from '../use-container-move'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { captureContextArchive, type CaptureContext } from './context-archive'
import { ELiftStep } from './lift'

export type { CaptureContext }

const WAKE_CONTEXT_NOTICE_KEY = 'wake-context-put-failed'

/**
 * Re-attaching to a thread's sandbox: the claim mints a fresh token and git credential, and the
 * driver resumes (or recreates) the sandbox before answering. The operator's context is only sent
 * up again when the sandbox booted fresh — a resumed sandbox's snapshot already has it, so neither
 * the (expensive) tar nor the upload runs. Narrated through `move` when one is given, so a wake
 * reached from an idle conversation reads as progress rather than as a stall.
 */
export async function wakeSandbox(args: {
  bridge: CloudBridge
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  captureContext?: CaptureContext | undefined
}): Promise<{ url: string; token: string; created: boolean }> {
  args.move?.handleBegin({ target: EExecutionLocation.Cloud, plan: WAKE_PLAN, heading: WAKE_HEADING })
  args.move?.handleAdvance(ELiftStep.Starting)

  const woken = await args.bridge.sandboxes.create({
    threadId: args.threadId,
    workspace: null,
    captureContext: async (put) => {
      try {
        const archive = await (args.captureContext ?? captureContextArchive)()
        if (archive !== undefined) await put(archive)
      } catch (error) {
        notify({
          key: WAKE_CONTEXT_NOTICE_KEY,
          text: `the fresh sandbox woke without this machine's context — ${messageOf(error)}`,
          tone: ENoticeTone.Warn,
          ttlMs: NOTICE_WARN_MS,
        })
      }
    },
  })

  args.move?.handleAdvance(ELiftStep.Attaching)
  return { url: woken.url, token: woken.token, created: woken.created }
}

export function createCloudRunner(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  move?: ContainerMoveControl | undefined
  captureContext?: CaptureContext | undefined
}): RemoteTurnRunner {
  const wake = async (): Promise<void> => {
    try {
      const woken = await wakeSandbox({
        bridge: args.bridge,
        threadId: args.threadId,
        ...(args.move === undefined ? {} : { move: args.move }),
        ...(args.captureContext === undefined ? {} : { captureContext: args.captureContext }),
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
