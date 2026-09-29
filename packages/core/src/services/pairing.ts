import type { Event, EventOfType } from '../events/envelope'
import {
  endedKeysOf,
  lifecycleOf,
  lostOf,
  type Lifecycle,
  type LifecycleKind,
} from '../lifecycle/lifecycle'

type StartedService = EventOfType<'service-started'>
type EndedService = EventOfType<'service-ended'>

export type ServiceLifecycle = Lifecycle<StartedService, EndedService>

/**
 * How a service maps onto the log: `service-started` opens it, `service-ended` closes it, and the
 * serviceId identifies one instance within a boot. The bootId is the scope because svc ids restart
 * at svc_1 in every session, so a new process's end must never settle a previous process's open
 * start; events written before bootId existed carry none and share the empty scope, which is the
 * old id-only behaviour for exactly the old data it described.
 */
export const serviceLifecycleKind: LifecycleKind<StartedService, EndedService> = {
  isStart(event): event is StartedService {
    return event.type === 'service-started'
  },
  isEnd(event): event is EndedService {
    return event.type === 'service-ended'
  },
  keyOf(event) {
    return event.serviceId
  },
  scopeOf(event) {
    return event.bootId ?? ''
  },
}

/** Every service lifecycle in the stream, paired by (bootId, serviceId) FIFO. */
export const servicesLifecycle = (events: readonly Event[]): ServiceLifecycle[] =>
  lifecycleOf(events, serviceLifecycleKind)

/** The services whose start has no end: a crash or a kill the log never settled. */
export const lostServicesOf = (events: readonly Event[]): ServiceLifecycle[] =>
  lostOf(events, serviceLifecycleKind)

/** The pairing keys of every recorded end, for a teardown's "already recorded" check. */
export const endedServiceKeysOf = (events: readonly Event[]): ReadonlySet<string> =>
  endedKeysOf(events, serviceLifecycleKind)
