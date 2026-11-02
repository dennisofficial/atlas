import type { LogPort, ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../logging/log-fields'
import type { FailureDiagnostics } from '../model/run-failure'
import type { AgentOutput } from './agent-output'
import type { OnceLedger } from './once-ledger.port'
import type { RetryDeps } from './retrying-step'

export function retryDepsFor(args: {
  retry: RetryDeps | undefined
  output: AgentOutput | undefined
  logPort: LogPort | undefined
  diagnostics: FailureDiagnostics | undefined
  threadId: ThreadId
  onceLedger: OnceLedger | undefined
}): RetryDeps | undefined {
  const { output, logPort, diagnostics, threadId, onceLedger } = args
  const base: RetryDeps | undefined =
    onceLedger === undefined ? args.retry : { ...(args.retry ?? {}), onceLedger }
  if (logPort === undefined && output === undefined) return base
  const held = args.retry?.onWaiting
  return {
    ...base,
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
