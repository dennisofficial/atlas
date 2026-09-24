import type { ThreadId } from '@dltech/atlas-core'
import type { ServiceRegistryPort, ServiceSnapshot } from '@dltech/atlas-harness'
import { useCallback, useSyncExternalStore } from 'react'

import { useWakeWitness } from './use-wake-witness'

/**
 * A service that ends while nothing is running has no turn to be delivered into, so the ending is
 * what starts one. Mid-turn there is nothing to do: the loop drains the same queue on its next
 * pass.
 *
 * A turn must not start behind a prompt that has taken the keyboard, so an overlay waiting on an
 * answer holds the wake off until it is closed. The ending keeps until then.
 *
 * Only this thread's endings are read, and only this thread is woken: a service is listed
 * session-wide, but its ending belongs to whoever started it.
 */
export function useServiceWake(args: {
  services: ServiceRegistryPort
  threadId: ThreadId
  working: boolean
  canWake: boolean
  onWake: () => void
}): readonly ServiceSnapshot[] {
  const { services, threadId, working, canWake, onWake } = args

  const subscribe = useCallback((listener: () => void) => services.onNotice(listener), [services])
  const read = useCallback(() => services.pendingNotices({ threadId }), [services, threadId])
  const notices = useSyncExternalStore(subscribe, read)

  const witness =
    notices.length === 0 ? null : notices.map((notice) => notice.serviceId).join(' ')

  useWakeWitness({ witness, blocked: working || !canWake, onWake })

  return notices
}
