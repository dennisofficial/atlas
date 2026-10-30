import type { Event, ThreadId } from '@dltech/atlas-core'
import {
  assemblePodThread,
  NoLocalPodCopyError,
  openParkedPodThread,
  type CloudBridge,
  type PodThread,
  type PodThreadPorts,
} from '@dltech/atlas-harness'
import type { ILocalStore } from './local-store'

type Transcript = { events: readonly Event[] }
type HeldPod = PodThread<Transcript>

export interface IPodThreads {
  hold: (args: { threadId: ThreadId }) => Promise<HeldPod>
  wake: (args: { threadId: ThreadId }) => Promise<HeldPod>
  dial: (args: { threadId: ThreadId; url: string; token: string }) => Promise<void>
  release: (args: { threadId: ThreadId }) => Promise<void>
  closeAll: () => void
}

const QUIET_NOTICES = { notify: () => undefined }

export function createPodThreads({
  store,
  bridge,
}: {
  store: ILocalStore
  bridge: () => CloudBridge
}): IPodThreads {
  const held = new Map<ThreadId, Promise<HeldPod>>()

  const portsFor = (threadId: ThreadId): PodThreadPorts<Transcript> => ({
    bridge: bridge(),
    threadId,
    home: store.threads,
    notice: QUIET_NOTICES,
    onReload: async () => undefined,
    open: async (runtime) => ({ events: await runtime.log.read({ threadId }) }),
    localCopy: { home: store.home, threads: store.threads },
  })

  const local = { log: store.log, threads: store.threads, ledger: store.ledger }

  const opened = async (threadId: ThreadId): Promise<HeldPod> => {
    const ports = portsFor(threadId)
    try {
      return await openParkedPodThread({ ...ports, local })
    } catch (error) {
      if (!(error instanceof NoLocalPodCopyError)) throw error
      const projectId = (await store.threads.find({ threadId }))?.projectId ?? null
      return assemblePodThread({
        ...ports,
        attachment: ports.bridge.attach({ threadId }),
        projectId,
        transcript: local,
      })
    }
  }

  const hold = ({ threadId }: { threadId: ThreadId }): Promise<HeldPod> => {
    const existing = held.get(threadId)
    if (existing !== undefined) return existing
    const opening = opened(threadId)
    held.set(threadId, opening)
    opening.catch(() => {
      if (held.get(threadId) === opening) held.delete(threadId)
    })
    return opening
  }

  const release = async ({ threadId }: { threadId: ThreadId }): Promise<void> => {
    const existing = held.get(threadId)
    held.delete(threadId)
    const pod = await existing?.catch(() => undefined)
    pod?.close()
    await pod?.copySettled()
  }

  return {
    hold,
    wake: async ({ threadId }) => {
      const pod = await hold({ threadId })
      await pod.runner.ensureAttached()
      return pod
    },
    dial: async ({ threadId, url, token }) => {
      const pod = await hold({ threadId })
      if (pod.attachment.channel.attachment() === undefined)
        pod.attachment.channel.wake({ url, token })
    },
    release,
    closeAll: () => {
      for (const threadId of [...held.keys()]) void release({ threadId })
    },
  }
}
