import type { ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '@dltech/atlas-observability'
import type { FailureDiagnostics } from '../model/run-failure'
import type { AgentOutput } from './agent-output'
import type { RetryDeps } from './retrying-step'
import type { LogPort } from '@dltech/atlas-observability'

export function retryDepsFor(args: {
  retry: RetryDeps | undefined
  output: AgentOutput | undefined
  logPort: LogPort | undefined
  diagnostics: FailureDiagnostics | undefined
  threadId: ThreadId
}): RetryDeps | undefined {
  const { output, logPort, diagnostics, threadId } = args
  if (logPort === undefined && output === undefined) return args.retry
  const held = args.retry?.onWaiting
  return {
    ...args.retry,
    ...(output === undefined
      ? {}
      : {
          onWaiting: (notice) => {
            output.emit({ type: 'retrying', ...notice })
            held?.(notice)
          },
        }),
    ...(logPort === undefined
      ? {}
      : {
          log: ({ attempt, maxAttempts, reason, willRetry, error }) => {
            logPort.warn({
              source: 'loop.retry',
              message: willRetry
                ? `model step failed (attempt ${attempt}/${maxAttempts}, ${reason}) — retrying`
                : `model step failed (attempt ${attempt}/${maxAttempts}, ${reason}) — not retrying`,
              threadId,
              data: {
                attempt,
                maxAttempts,
                reason,
                willRetry,
                modelError: diagnostics?.(error) ?? {},
              },
              ...logFieldsOf({ error }),
            })
          },
        }),
  }
}
