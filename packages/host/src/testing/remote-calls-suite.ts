import { describeRemoteCallsLifecycle } from './remote-calls-lifecycle'
import { describeRemoteCallsRecovery } from './remote-calls-scope'
import type { RemoteCallsTarget } from './remote-calls-support'

export {
  fakeTimers,
  type RemoteCallsHandle,
  type RemoteCallsTarget,
  type SlowTimers,
} from './remote-calls-support'

export const describeRemoteCalls = (target: RemoteCallsTarget): void => {
  describeRemoteCallsLifecycle(target)
  describeRemoteCallsRecovery(target)
}
