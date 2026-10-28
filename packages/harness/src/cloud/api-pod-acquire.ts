import { EPodState, ESandboxProvisionState, type PodConnectReply } from '@dltech/atlas-wire'

import type { PodApiClient } from './api-pod-client'
import { notConfiguredOf } from './api-pod-errors'
import { type PodWaitOptions, waitForPodRunning } from './api-pod-wait'
import { cloudCall } from './api-trpc-client'

export type PodAcquireArgs = {
  api: PodApiClient
  threadId: string
  wait: PodWaitOptions
}

export const provisionPod = async (args: {
  api: Pick<PodApiClient, 'threadSandbox'>
  threadId: string
}): Promise<void> => {
  const reply = await cloudCall(
    args.api.threadSandbox.provision.mutate({ threadId: args.threadId }),
  )
  if (reply.state === ESandboxProvisionState.NotConfigured) {
    throw notConfiguredOf({ error: reply.error, gap: reply.gap })
  }
}

export const acquirePod = async (args: PodAcquireArgs): Promise<PodConnectReply> => {
  const { api, threadId } = args
  const status = await cloudCall(api.threadPod.status.query({ threadId }))
  if (status.state !== EPodState.Running) {
    await provisionPod({ api, threadId })
    await waitForPodRunning({ api, threadId, ...args.wait })
  }
  return cloudCall(api.threadPod.connect.mutate({ threadId }))
}
