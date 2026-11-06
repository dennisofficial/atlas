import { z } from 'zod'

import type { V2Event } from './event'

export const sessionStartFailedSchema = z.object({
  type: z.literal('session-start-failed'),
  reason: z.string(),
  inboxHead: z.number().int().min(0),
  permanent: z.boolean(),
})

export type SessionStartFailed = z.infer<typeof sessionStartFailedSchema>

export type StartFailure = {
  inboxHead: number
  reason: string
  permanent: boolean
  at: string
}

const ENDS_START_FAILURE: ReadonlySet<V2Event['type']> = new Set([
  'user-said',
  'assistant-said',
  'workspace-prepared',
  'workspace-prepare-failed',
  'run-failed',
])

export const activeStartFailure = (events: readonly V2Event[]): StartFailure | undefined => {
  const index = events.findLastIndex((event) => event.type === 'session-start-failed')
  const failed = events[index]
  if (failed === undefined || failed.type !== 'session-start-failed') return undefined
  if (events.slice(index + 1).some((event) => ENDS_START_FAILURE.has(event.type))) return undefined
  return {
    inboxHead: failed.inboxHead,
    reason: failed.reason,
    permanent: failed.permanent,
    at: failed.at,
  }
}
