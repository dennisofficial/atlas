import type { PodConnectReply } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'
import { CloudApiError } from '@/lib/cloud-api'

const CONFLICT = 409
const POD_NOT_RUNNING = 'pod-not-running'

export enum EPodConnectOutcome {
  Ready = 'ready',
  NotRunning = 'not-running',
}

export type PodConnectResult =
  | { outcome: EPodConnectOutcome.Ready; ticket: PodConnectReply }
  | { outcome: EPodConnectOutcome.NotRunning }

export async function connectPod(threadId: string): Promise<PodConnectResult> {
  try {
    const ticket = await cloudCall(api.threadPod.connect.mutate({ threadId }))
    return { outcome: EPodConnectOutcome.Ready, ticket }
  } catch (failure) {
    if (
      failure instanceof CloudApiError &&
      failure.status === CONFLICT &&
      failure.code === POD_NOT_RUNNING
    ) {
      return { outcome: EPodConnectOutcome.NotRunning }
    }
    throw failure
  }
}
