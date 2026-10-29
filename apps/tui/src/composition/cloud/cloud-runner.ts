import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'
import { RemoteTurnRunner } from '@dltech/atlas-harness'
import type { SettleWaitNotice } from '@dltech/atlas-wire'

import { WAKE_HEADING } from '../container-move'
import { messageOf } from '../error-text'
import type { BootNarration } from '../boot-block-store'
import type { CloudBridge, CloudChannel } from '@dltech/atlas-harness'

export const ROTATE_HEADING = 'Updating the pod'

const WAKE_ROWS = [
  { id: 'waiting', text: 'waiting for the pod', nodeIds: ['waiting'] },
  { id: 'attaching', text: 'attaching and verifying the conversation', nodeIds: ['attaching'] },
] as const

/**
 * The provider settle the mount is riding out, said as what it is: the wake row stops reading
 * "waiting for the pod" while the real wait is a name the registry has not released.
 */
const settleWaitTextOf = (notice: SettleWaitNotice): string => {
  const attempt = ` (attempt ${notice.attempt}/${notice.attempts})`
  return `waiting for Vercel to release the pod name${attempt}`
}

export async function wakeSandbox(args: {
  bridge: CloudBridge
  threadId: ThreadId
  projectId: string | null
  move?: BootNarration | undefined
  onRotationStarted?: (() => void) | undefined
}): Promise<{ url: string; token: string; created: boolean }> {
  args.move?.handleBegin({
    target: EExecutionLocation.Cloud,
    rows: WAKE_ROWS,
    heading: WAKE_HEADING,
  })

  const woken = await args.bridge.sandboxes.create({
    threadId: args.threadId,
    projectId: args.projectId,
    onRotationStarted: () => {
      args.onRotationStarted?.()
      args.move?.handleExpand({
        insertBefore: 'attaching',
        row: { id: 'rotating', text: 'updating the pod', nodeIds: ['rotating'] },
        heading: ROTATE_HEADING,
      })
    },
    onSettleWait: (notice) => {
      args.move?.handleRowLabel({ nodeId: 'waiting', text: settleWaitTextOf(notice) })
    },
  })

  args.move?.handleRowActive('attaching')
  return { url: woken.url, token: woken.token, created: woken.created }
}

export type CloudWake = () => Promise<void>

/**
 * One wake at a time: a background wake still provisioning when the operator sends (or a second
 * send racing the first) joins the wake already in flight instead of claiming the sandbox twice.
 */
export function createCloudWake(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  projectId: string | null
  move?: BootNarration | undefined
  onWoken?: ((woken: { created: boolean }) => void) | undefined
}): CloudWake {
  let inFlight: Promise<void> | null = null

  const run = async (): Promise<void> => {
    const move = args.move
    try {
      const woken = await wakeSandbox({
        bridge: args.bridge,
        threadId: args.threadId,
        projectId: args.projectId,
        ...(move === undefined ? {} : { move }),
        onRotationStarted: () => args.channel.beginRotation(),
      })
      args.onWoken?.({ created: woken.created })
      args.channel.wake({ url: woken.url, token: woken.token })
      move?.handleSettle()
    } catch (error) {
      move?.handleFail(messageOf(error))
      throw error
    }
  }

  return () => {
    if (inFlight !== null) return inFlight
    inFlight = run().finally(() => {
      inFlight = null
    })
    return inFlight
  }
}

export function createCloudRunner(args: {
  bridge: CloudBridge
  channel: CloudChannel
  threadId: ThreadId
  projectId: string | null
  move?: BootNarration | undefined
  wake?: CloudWake | undefined
}): RemoteTurnRunner {
  const wake = args.wake ?? createCloudWake(args)
  return new RemoteTurnRunner({ channel: args.channel, wake: () => wake() })
}
