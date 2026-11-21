import { z } from 'zod'

export enum ELiveOpFailure {
  Asleep = 'asleep',
  Absent = 'absent',
  Failed = 'failed',
}

export const liveOpFailureSchema = z.strictObject({
  reason: z.enum(ELiveOpFailure),
  message: z.string(),
})
export type LiveOpFailure = z.infer<typeof liveOpFailureSchema>

export const CP_POD_OPS = [
  'stat',
  'readFile',
  'readDirectory',
  'glob',
  'terminal.open',
  'terminal.write',
  'terminal.resize',
  'terminal.close',
  'terminal.read',
  'metrics.subscribe',
  'metrics.unsubscribe',
] as const

export const LIVE_OP_MAX_BYTES = 1_048_576
export const LIVE_OP_TIMEOUT_MS = 15_000
export const FILES_SEARCH_LIMIT = 200
export const POD_PARKED_MESSAGE = 'pod is asleep'
