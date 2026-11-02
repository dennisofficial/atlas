import {
  sleepUnlessAborted,
  takeModelStepWithRetry as takeAgentModelStepWithRetry,
  type ClockJumpDetector,
  type RetryDeps,
  type RetryNotice,
  type Waiting,
} from '@dltech/atlas-agent'

import { normalizeProviderFailure } from '../model/failure'

export {
  sleepUnlessAborted,
  type ClockJumpDetector,
  type RetryDeps,
  type RetryNotice,
  type Waiting,
}

export const takeModelStepWithRetry = (
  args: Omit<Parameters<typeof takeAgentModelStepWithRetry>[0], 'normalizeFailure'>,
) => takeAgentModelStepWithRetry({ ...args, normalizeFailure: normalizeProviderFailure })
