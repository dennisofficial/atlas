import type { NoticePort, NoticePost, ThreadId } from '@dltech/atlas-core'
import type { SettleWaitNotice } from '@dltech/atlas-wire'

import {
  ECloudSandboxState,
  type CloudSandbox,
  type CloudSandboxes,
} from '../../cloud/cloud-bridge'
import type { PodWakeNarration } from '../pod-wake'

export type CreateCall = { threadId: ThreadId; projectId: string | null }

export type FakeSandboxes = Pick<CloudSandboxes, 'create' | 'find'> & {
  readonly created: readonly CreateCall[]
}

export const RUNNING_POD: CloudSandbox = {
  url: 'https://pod.example/thread',
  token: 'pod-token',
  state: ECloudSandboxState.Running,
  created: false,
}

export function fakeSandboxes(
  args: {
    sandbox?: CloudSandbox | undefined
    createFails?: Error | undefined
    rotates?: boolean | undefined
    settleWait?: SettleWaitNotice | undefined
    gate?: Promise<void> | undefined
  } = {},
): FakeSandboxes {
  const created: CreateCall[] = []
  return {
    created,
    create: async (call) => {
      created.push({ threadId: call.threadId, projectId: call.projectId })
      await args.gate
      if (args.settleWait !== undefined) call.onSettleWait?.(args.settleWait)
      if (args.rotates === true) call.onRotationStarted?.()
      if (args.createFails !== undefined) throw args.createFails
      return args.sandbox ?? RUNNING_POD
    },
    find: async () => undefined,
  }
}

export type RecordingNarration = PodWakeNarration & { readonly calls: readonly string[] }

export function recordingNarration(): RecordingNarration {
  const calls: string[] = []
  return {
    calls,
    begin: () => calls.push('begin'),
    rotating: () => calls.push('rotating'),
    settleWait: (notice) => calls.push(`settle-wait:${notice.attempt}/${notice.attempts}`),
    attaching: () => calls.push('attaching'),
    settled: () => calls.push('settled'),
    failed: (reason) => calls.push(`failed:${reason}`),
  }
}

export type FakeWakeChannel = {
  wake(args: { url: string; token: string }): void
  beginRotation(): void
  readonly woken: readonly { url: string; token: string }[]
  readonly rotations: number
}

export function fakeWakeChannel(): FakeWakeChannel {
  const woken: { url: string; token: string }[] = []
  let rotations = 0
  return {
    woken,
    wake: (dial) => {
      woken.push(dial)
    },
    beginRotation: () => {
      rotations += 1
    },
    get rotations() {
      return rotations
    },
  }
}

export type RecordingNotices = NoticePort & { readonly posted: readonly NoticePost[] }

export function recordingNotices(): RecordingNotices {
  const posted: NoticePost[] = []
  return {
    posted,
    notify: (post) => {
      posted.push(post)
    },
  }
}
