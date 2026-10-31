import { EPodConnectOutcome, type PodConnectResult } from '@/features/threads/data/pod-connect'

import { connectLocalPod, getLocalPod, wakeLocalPod, ELocalPodState } from './desktop-wire'

export async function mintLocalPod(threadId: string): Promise<PodConnectResult> {
  const pod = await getLocalPod(threadId)
  if (pod === null || pod.state !== ELocalPodState.Running) {
    return { outcome: EPodConnectOutcome.NotRunning }
  }
  const ticket = await connectLocalPod(threadId)
  return ticket === null
    ? { outcome: EPodConnectOutcome.NotRunning }
    : { outcome: EPodConnectOutcome.Ready, ticket }
}

export async function wakeAndConnectLocalPod(threadId: string): Promise<PodConnectResult> {
  await wakeLocalPod(threadId)
  const ticket = await connectLocalPod(threadId)
  return ticket === null
    ? { outcome: EPodConnectOutcome.NotRunning }
    : { outcome: EPodConnectOutcome.Ready, ticket }
}

export { readLocalSeed } from './local-thread-history'
