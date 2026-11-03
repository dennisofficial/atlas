import { toRunId, toThreadId } from '../../events/ids'
import { chainEvents } from '../chain-events'
import type { LogHead } from '../chain'
import type { V2Body, V2Event } from '../event'
import type { Lease } from '../lease'

export const threadId = toThreadId('thread-1')
export const runId = toRunId('run-1')
export const NOW = '2026-11-02T12:00:00.000Z'

export const lease = (overrides: Partial<Lease> = {}): Lease => ({
  sessionId: 'session-1',
  epoch: 3,
  holderId: 'pod-a',
  renewedAt: NOW,
  ttlMs: 30_000,
  wantsHolder: false,
  ...overrides,
})

export const userSaid = (text: string): V2Body => ({ type: 'user-said', text })

export const mint = (params: { count: number; epoch?: number; from?: LogHead }): V2Event[] =>
  chainEvents({
    threadId,
    runId,
    epoch: params.epoch ?? 3,
    at: NOW,
    from: params.from,
    bodies: Array.from({ length: params.count }, (_, index) => userSaid(`m${index}`)),
  })
