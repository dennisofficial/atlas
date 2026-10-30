import type { Event } from '@dltech/atlas-core'

import type { CloudStores } from '../cloud/cloud-bridge'
import { assemblePodThread, type PodThread, type PodThreadPorts } from './pod-thread'

export class NoLocalPodCopyError extends Error {
  constructor(threadId: string) {
    super(`no local copy of the pod thread "${threadId}" to open from`)
    this.name = 'NoLocalPodCopyError'
  }
}

/** Opens a pod thread from its local copy against a parked channel: the pod wakes only on an action. */
export async function openParkedPodThread<Opened extends { events: readonly Event[] }>(
  args: PodThreadPorts<Opened> & { local: CloudStores },
): Promise<PodThread<Opened>> {
  const { threadId } = args
  await args.local.log.refresh({ threadId })
  if ((await args.local.log.head({ threadId })) === 0) throw new NoLocalPodCopyError(threadId)
  const projectId = (await args.home.find({ threadId }))?.projectId ?? null
  const attachment = args.bridge.attach({ threadId })
  const pod = await assemblePodThread({ ...args, attachment, projectId, transcript: args.local })
  return { ...pod, settleOpen: pod.session.settleOpen }
}
