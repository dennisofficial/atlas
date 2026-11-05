export { FaultProxy, type ProxyFault } from './fault-proxy'
export { createMemoryHostPresence, type MemoryHostPresence } from './memory-host-presence'
export {
  describeHostPresence,
  type HostPresenceHandle,
  type HostPresenceTarget,
} from './host-presence-suite'
export {
  describeRemoteCalls,
  fakeTimers,
  type RemoteCallsHandle,
  type RemoteCallsTarget,
  type SlowTimers,
} from './remote-calls-suite'
