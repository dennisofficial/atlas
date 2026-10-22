import { EClientRequest } from './channel-wire'

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
export const LONG_REQUEST_TIMEOUT_MS = 120_000
export const COMPACTION_REQUEST_TIMEOUT_MS = 600_000

const COMPACTION: ReadonlySet<EClientRequest> = new Set([
  EClientRequest.CompactHistory,
  EClientRequest.SummariseHistory,
])

const LONG_RUNNING: ReadonlySet<EClientRequest> = new Set([
  EClientRequest.ReadTranscriptIdentity,
  EClientRequest.ProvideOperatorInput,
])

export const requestTimeoutFor = (args: {
  op: EClientRequest
  overrideMs?: number | undefined
}): number => {
  if (args.overrideMs !== undefined) return args.overrideMs
  if (COMPACTION.has(args.op)) return COMPACTION_REQUEST_TIMEOUT_MS
  return LONG_RUNNING.has(args.op) ? LONG_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS
}
