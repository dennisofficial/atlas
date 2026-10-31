import type { ThreadBackend } from '@/features/threads/data/thread-backend'

import { deliverHeldFirstMessage } from './first-message'
import { fetchLocalPodStatus, resizeLocalPod, wakeLocalPod } from './desktop-wire'
import { localThreadOf } from './local-thread'
import { mintLocalPod, wakeAndConnectLocalPod } from './local-thread-source'
import { readLocalEvents, readLocalSeed } from './local-thread-history'
import { subscribeLocalThreadStream } from './local-thread-feed'
import { getLocalThread, markLocalThreadRead, renameLocalThread } from './local-thread-wire'

export const NOT_CONNECTED = 'This Mac pod is not connected yet'
export const UNSUPPORTED_ON_MAC = 'This is not available for threads on this Mac yet'

const unsupported = async (): Promise<never> => {
  throw new Error(UNSUPPORTED_ON_MAC)
}

const readStoredLocalThread = async (threadId: string) => {
  const thread = await getLocalThread(threadId)
  if (thread === null) throw new Error('This thread no longer exists on this Mac')
  return localThreadOf(thread)
}

export const localThreadBackend: ThreadBackend = {
  local: true,
  fetchThread: readStoredLocalThread,
  fetchPod: fetchLocalPodStatus,
  fetchEvents: readLocalEvents,
  fetchSeed: readLocalSeed,
  rename: renameLocalThread,
  fetchSpawned: async () => [],
  mint: mintLocalPod,
  wake: wakeAndConnectLocalPod,
  postMessage: async () => {
    throw new Error(NOT_CONNECTED)
  },
  takeBack: unsupported,
  patchModel: unsupported,
  rewind: unsupported,
  provision: async ({ threadId }) => {
    await wakeLocalPod(threadId)
  },
  resize: resizeLocalPod,
  markRead: markLocalThreadRead,
  subscribeStream: subscribeLocalThreadStream,
  afterConnect: deliverHeldFirstMessage,
}
