import type { ThreadId } from '@dltech/atlas-core'
import type { SettleWaitNotice } from '@dltech/atlas-wire'

import type { CloudBridge, CloudChannel } from '../cloud/cloud-bridge'
import { RemoteTurnRunner } from '../cloud/remote-turn-runner'

export type PodWakeNarration = {
  begin(): void
  rotating(): void
  settleWait(notice: SettleWaitNotice): void
  attaching(): void
  settled(): void
  failed(reason: string): void
}

export type PodWake = () => Promise<void>

export type PodSandboxes = { sandboxes: Pick<CloudBridge['sandboxes'], 'create'> }

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export async function wakePod(args: {
  bridge: PodSandboxes
  threadId: ThreadId
  projectId: string | null
  narration?: PodWakeNarration | undefined
  onRotationStarted?: (() => void) | undefined
}): Promise<{ url: string; token: string; created: boolean }> {
  args.narration?.begin()
  const woken = await args.bridge.sandboxes.create({
    threadId: args.threadId,
    projectId: args.projectId,
    onRotationStarted: () => {
      args.onRotationStarted?.()
      args.narration?.rotating()
    },
    onSettleWait: (notice) => args.narration?.settleWait(notice),
  })
  args.narration?.attaching()
  return { url: woken.url, token: woken.token, created: woken.created }
}

/** One wake at a time: a second caller joins the wake already in flight. */
export function createPodWake(args: {
  bridge: PodSandboxes
  channel: Pick<CloudChannel, 'wake' | 'beginRotation'>
  threadId: ThreadId
  projectId: string | null
  narration?: PodWakeNarration | undefined
}): PodWake {
  let inFlight: Promise<void> | null = null

  const run = async (): Promise<void> => {
    try {
      const woken = await wakePod({
        bridge: args.bridge,
        threadId: args.threadId,
        projectId: args.projectId,
        narration: args.narration,
        onRotationStarted: () => args.channel.beginRotation(),
      })
      args.channel.wake({ url: woken.url, token: woken.token })
      args.narration?.settled()
    } catch (error) {
      args.narration?.failed(reasonOf(error))
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

export function createPodRunner(args: {
  bridge: PodSandboxes
  channel: CloudChannel
  threadId: ThreadId
  projectId: string | null
  narration?: PodWakeNarration | undefined
  wake?: PodWake | undefined
}): RemoteTurnRunner {
  const wake = args.wake ?? createPodWake(args)
  return new RemoteTurnRunner({ channel: args.channel, wake: () => wake() })
}

export const podFailureReasonOf = reasonOf
