import type { ThreadId } from '@dltech/atlas-core'

import type { RetryDeps } from './retrying-step'
import type { OnceLedger } from './once-ledger.port'

export const stepRetryDeps = (args: {
  retry: RetryDeps | undefined
  onceLedger: OnceLedger | undefined
  threadId: ThreadId
  stepBase: number
}): RetryDeps | undefined => {
  if (args.onceLedger === undefined) return args.retry
  return {
    ...args.retry,
    ledger: {
      onceLedger: args.onceLedger,
      stepKey: `retry:${args.threadId}:s${args.stepBase}`,
    },
  }
}
