import type { ThreadBackend } from '@/features/threads/data/thread-backend'

import { deliverHeldFirstMessage } from './first-message'
import { ELocalPodState, getLocalPod, wakeLocalPod, type LocalPod } from './desktop-wire'
import { localThreadOf, podStatusOf } from './local-thread'
import { mintLocalPod } from './local-thread-source'

export const NOT_CONNECTED = 'This Mac pod is not connected yet'
export const UNSUPPORTED_ON_MAC = 'This is not available for threads on this Mac yet'

const unsupported = async (): Promise<never> => {
  throw new Error(UNSUPPORTED_ON_MAC)
}

const requirePod = async (threadId: string): Promise<LocalPod> => {
  const pod = await getLocalPod(threadId)
  if (pod === null) throw new Error('This thread no longer exists on this Mac')
  return pod
}

export const localThreadBackend: ThreadBackend = {
  local: true,
  fetchThread: async (threadId) => localThreadOf(await requirePod(threadId)),
  fetchPod: async (threadId) => {
    const pod = await requirePod(threadId)
    const awake = pod.state === ELocalPodState.Stopped ? await wakeLocalPod(threadId) : pod
    return podStatusOf(awake)
  },
  fetchEvents: async () => [],
  fetchSeed: async () => [],
  fetchSpawned: async () => [],
  mint: mintLocalPod,
  postMessage: async () => {
    throw new Error(NOT_CONNECTED)
  },
  takeBack: unsupported,
  patchModel: unsupported,
  rewind: unsupported,
  provision: async ({ threadId }) => {
    await wakeLocalPod(threadId)
  },
  resize: unsupported,
  markRead: async () => undefined,
  subscribeStream: () => ({ unsubscribe: () => undefined }),
  afterConnect: deliverHeldFirstMessage,
}
