import type { ThreadId } from '@dltech/atlas-core'
import {
  EPodResizeApplies,
  EPodState,
  type PodStatus,
  type RuntimeCheckpoint,
} from '@dltech/atlas-wire'

import { acquirePod } from './api-pod-acquire'
import { apiPodAttachmentOf, type ApiPodAttachOptions } from './api-pod-attachment'
import { createBornThread } from './api-pod-birth'
import type { PodApiClient } from './api-pod-client'
import type { PodWaitOptions } from './api-pod-wait'
import { cloudCall } from './api-trpc-client'
import {
  type CloudBridge,
  type CloudSandboxes,
  type CloudSandboxStatus,
  EResizeApplies,
} from './cloud-bridge'
import { ECloudSandboxState } from './sandbox-client'
import type { SsePullRequestClock } from './sse-pull-request-clock'

export const DEFAULT_POD_TIMEOUT_MS = 300_000
export const DEFAULT_POD_POLL_MS = 3_000

export type ApiPodBridgeOptions = ApiPodAttachOptions & {
  api: PodApiClient
  timeoutMs?: number | undefined
  pollMs?: number | undefined
  clock?: SsePullRequestClock | undefined
  onBootStep?: ((args: { threadId: ThreadId; label: string }) => void) | undefined
}

const SANDBOX_STATES: Readonly<Record<EPodState, ECloudSandboxState>> = {
  [EPodState.Running]: ECloudSandboxState.Running,
  [EPodState.Booting]: ECloudSandboxState.Resuming,
  [EPodState.Parked]: ECloudSandboxState.Parked,
  [EPodState.Failed]: ECloudSandboxState.Stopped,
  [EPodState.None]: ECloudSandboxState.Stopped,
}

const RESIZE_APPLIES: Readonly<Record<EPodResizeApplies, EResizeApplies>> = {
  [EPodResizeApplies.Live]: EResizeApplies.Live,
}

const checkpointOf = async (args: {
  api: PodApiClient
  threadId: ThreadId
}): Promise<RuntimeCheckpoint | null> => {
  const reply = await cloudCall(args.api.sandboxCheckpoint.get.query({ threadId: args.threadId }), {
    allowMissing: true,
  }).catch(() => undefined)
  const checkpoint = reply?.checkpoint ?? null
  return checkpoint?.threadId === args.threadId ? checkpoint : null
}

const resourcesOf = (status: PodStatus): { vcpus?: number; memoryMb?: number } => ({
  ...(status.resources?.vcpus === undefined ? {} : { vcpus: status.resources.vcpus }),
  ...(status.resources?.memoryMb === undefined ? {} : { memoryMb: status.resources.memoryMb }),
})

export const createApiPodBridge = (options: ApiPodBridgeOptions): CloudBridge => {
  const { api } = options

  const waitOf = (threadId: ThreadId): PodWaitOptions => ({
    timeoutMs: options.timeoutMs ?? DEFAULT_POD_TIMEOUT_MS,
    pollMs: options.pollMs ?? DEFAULT_POD_POLL_MS,
    clock: options.clock,
    onStep: (label) => options.onBootStep?.({ threadId, label }),
  })

  const ticketOf = ({ threadId }: { threadId: ThreadId }) =>
    acquirePod({ api, threadId, wait: waitOf(threadId) })

  const create: CloudSandboxes['create'] = async (args) => {
    const { threadId } = args
    if (args.birth !== undefined) {
      await createBornThread({
        api,
        threadId,
        projectId: args.projectId,
        model: args.model,
        effort: args.birth.effort,
      })
    }
    const ticket = await ticketOf({ threadId })
    return {
      url: ticket.url,
      token: ticket.token,
      state: ECloudSandboxState.Running,
      created: false,
    }
  }

  const find: CloudSandboxes['find'] = async ({ threadId }) => {
    const [status, checkpoint] = await Promise.all([
      cloudCall(api.threadPod.status.query({ threadId }), {
        allowMissing: true,
      }),
      checkpointOf({ api, threadId }),
    ])
    if (status === undefined) return undefined
    const found: CloudSandboxStatus = {
      state: SANDBOX_STATES[status.state],
      checkpoint,
    }
    return found
  }

  const readResources: CloudSandboxes['readResources'] = async ({ threadId }) => {
    const status = await cloudCall(api.threadPod.status.query({ threadId }), {
      allowMissing: true,
    })
    return status === undefined ? {} : resourcesOf(status)
  }

  const updateResources: CloudSandboxes['updateResources'] = async ({ threadId, vcpus }) => {
    const reply = await cloudCall(api.threadPod.resize.mutate({ threadId, vcpus }))
    return { appliesAt: RESIZE_APPLIES[reply.appliesAt] }
  }

  const destroy = async ({
    threadId,
  }: Pick<Parameters<CloudSandboxes['destroy']>[0], 'threadId'>) => {
    await cloudCall(api.threadPod.destroy.mutate({ threadId }), {
      allowMissing: true,
    })
  }

  return {
    sandboxes: { create, find, readResources, updateResources, destroy },
    attach: apiPodAttachmentOf({ options, ticketOf }),
  }
}
