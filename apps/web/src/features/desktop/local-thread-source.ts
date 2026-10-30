import { EPodConnectOutcome, type PodConnectResult } from '@/features/threads/data/pod-connect'

import { connectLocalPod, getLocalPod, wakeLocalPod, ELocalPodState } from './desktop-wire'

export async function mintLocalPod(threadId: string): Promise<PodConnectResult> {
  const pod = await getLocalPod(threadId)
  if (pod === null) return { outcome: EPodConnectOutcome.NotRunning }
  if (pod.state === ELocalPodState.Stopped) await wakeLocalPod(threadId)
  const ticket = await connectLocalPod(threadId)
  return ticket === null
    ? { outcome: EPodConnectOutcome.NotRunning }
    : { outcome: EPodConnectOutcome.Ready, ticket }
}

export const readLocalSeed = async () => []
