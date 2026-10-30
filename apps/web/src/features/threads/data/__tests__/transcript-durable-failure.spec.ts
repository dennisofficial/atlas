import { describe, expect, it } from 'bun:test'

import type { WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { durableTranscriptOf, transcriptViewOf } from '../transcript-items'

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-30T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const authFailure = wire(2, {
  type: 'run-failed',
  failure: {
    kind: 'auth',
    message: 'Invalid API key',
    statusCode: 401,
    providerId: 'inference',
    modelId: 'gpt-4.1-mini',
    accountId: 'acct_1',
  },
})

const viewOf = (rows: readonly WireEvent[]) =>
  transcriptViewOf({
    durable: durableTranscriptOf({ events: eventsFromWire(rows) }),
    live: [],
    accountLabelOf: (accountId) => (accountId === 'acct_1' ? 'Work key' : undefined),
  })

describe('a durable run failure in history', () => {
  it('shows the banner with no live steps, as after a refresh', () => {
    const view = viewOf([wire(1, { type: 'user-said', text: 'hi' }), authFailure])

    expect(view.failure?.showSettings).toBe(true)
    expect(view.failure?.detail).toContain('Work key')
  })

  it('is hidden once the operator says something after it', () => {
    const view = viewOf([
      wire(1, { type: 'user-said', text: 'hi' }),
      authFailure,
      wire(3, { type: 'user-said', text: 'again' }),
    ])

    expect(view.failure).toBeNull()
  })
})
