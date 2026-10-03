import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { RemoteTurnRunner, type CaptureContext } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import { ELocalMoveStep, WAKE_HEADING, WAKE_PLAN } from '../container-move'
import { messageOf } from '../error-text'
import type { ContainerMoveControl } from '../use-container-move'
import type { CloudBridge, CloudChannel } from '@dltech/atlas-harness'
import { ELiftStep } from '@dltech/atlas-harness'

export type { CaptureContext }

const WAKE_CONTEXT_NOTICE_KEY = 'wake-context-put-failed'

export const ROTATE_HEADING = 'UPDATING THE CLOUD SANDBOX'

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
  captureContext: CaptureContext
  move?: ContainerMoveControl | undefined
}): Promise<{ url: string; token: string; created: boolean }> {
  args.move?.handleBegin({ target: EExecutionLocation.Cloud, plan: WAKE_PLAN, heading: WAKE_HEADING })
  args.move?.handleAdvance(ELiftStep.Starting)

  const woken = await args.bridge.sandboxes.create({
    threadId: args.threadId,
    workspace: null,
    onRotationStarted: () => {
      args.move?.handleExpand({
        insertBefore: ELiftStep.Attaching,
        step: ELocalMoveStep.Rotating,
        heading: ROTATE_HEADING,
      })
    },
    captureContext: async (put) => {
      try {
        const archive = await args.captureContext()
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

export type CloudWake = (options?: { quiet?: boolean }) => Promise<void>

/**
 * One wake at a time: a background wake still provisioning when the operator sends (or a second
 * send racing the first) joins the wake already in flight instead of claiming the sandbox twice.
 * A quiet wake runs behind an already-rendered transcript, so it narrates nothing through `move`.
 */
export function createCloudWake(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  captureContext: CaptureContext
  move?: ContainerMoveControl | undefined
  onWoken?: ((woken: { created: boolean }) => void) | undefined
}): CloudWake {
  let inFlight: Promise<void> | null = null

  const run = async (move: ContainerMoveControl | undefined): Promise<void> => {
    try {
      const woken = await wakeSandbox({
        bridge: args.bridge,
        threadId: args.threadId,
        captureContext: args.captureContext,
        ...(move === undefined ? {} : { move }),
      })
      args.onWoken?.({ created: woken.created })
      args.channel.wake({ url: woken.url, token: woken.token })
      move?.handleSettle()
    } catch (error) {
      move?.handleFail(messageOf(error))
      throw error
    }
  }

  return (options) => {
    if (inFlight !== null) return inFlight
    inFlight = run(options?.quiet === true ? undefined : args.move).finally(() => {
      inFlight = null
    })
    return inFlight
  }
}

export function createCloudRunner(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  captureContext: CaptureContext
  move?: ContainerMoveControl | undefined
  wake?: CloudWake | undefined
}): RemoteTurnRunner {
  const wake = args.wake ?? createCloudWake(args)
  return new RemoteTurnRunner({ channel: args.channel, wake: () => wake() })
}
