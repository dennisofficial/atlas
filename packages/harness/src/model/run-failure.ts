import type { RunFailure } from '@dltech/atlas-core'
import { runFailureWith, safeFailureMessage } from '@dltech/atlas-agent'

import { normalizeProviderFailure } from './failure'

export { safeFailureMessage }

export function runFailureOf(args: {
  message: string
  cause: unknown
  providerId?: string | undefined
  modelId?: string | undefined
  escaped?: boolean | undefined
  nowMs?: number | undefined
}): RunFailure {
  return runFailureWith({ ...args, normalize: normalizeProviderFailure })
}
