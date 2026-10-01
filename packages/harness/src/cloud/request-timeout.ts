import { EClientRequest } from './channel-wire'

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
export const LONG_REQUEST_TIMEOUT_MS = 120_000

const LONG_RUNNING: ReadonlySet<EClientRequest> = new Set([
  EClientRequest.RestoreTranscript,
  EClientRequest.ReadSessionArchive,
  EClientRequest.ReadMemoryArchive,
  EClientRequest.ReadTranscriptIdentity,
])

export const requestTimeoutFor = (args: {
  op: EClientRequest
  overrideMs?: number | undefined
}): number => {
  if (args.overrideMs !== undefined) return args.overrideMs
  return LONG_RUNNING.has(args.op) ? LONG_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS
}
