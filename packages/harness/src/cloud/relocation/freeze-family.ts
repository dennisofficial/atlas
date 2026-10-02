import type { ThreadId } from '@dltech/atlas-core'

import type { MessageIntake } from '../../intake'
import type { ThreadStorePort } from '../../store/thread-store'

export async function holdFamilyIntake(args: {
  threadId: ThreadId
  threads: Pick<ThreadStorePort, 'spawned'>
  intake: Pick<MessageIntake, 'hold'> | undefined
}): Promise<() => void> {
  const releases: (() => void)[] = []
  const visited = new Set<ThreadId>()
  const family = [args.threadId]
  try {
    for (const threadId of family) {
      if (visited.has(threadId)) continue
      visited.add(threadId)
      const release = args.intake?.hold({ threadId })
      if (release !== undefined) releases.push(release)
      const children = await args.threads.spawned({ threadId })
      family.push(...children.map((child) => child.id))
    }
  } catch (error) {
    for (const release of releases) release()
    throw error
  }
  return () => { for (const release of releases.splice(0)) release() }
}
