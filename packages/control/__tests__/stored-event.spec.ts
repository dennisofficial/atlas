import { describe, expect, it } from 'bun:test'
import { chainEvents, chainHash, toRunId, toThreadId } from '@dltech/atlas-core'

import { decodeStoredEvent, EMPTY_VISIBILITY_TEXT, toStoredEvent } from '../src/stored-event'

const [event] = chainEvents({
  threadId: toThreadId('thread-1'),
  runId: toRunId('run-1'),
  epoch: 3,
  at: '2026-11-02T12:00:00.000Z',
  bodies: [{ type: 'user-said', text: 'm0' }],
})

describe('stored events', () => {
  it('stores the event as sorted-key canonical JSON', () => {
    const stored = toStoredEvent({ event: event!, hash: chainHash(event!) })
    expect(stored.canonical).toBe(
      '{"at":"2026-11-02T12:00:00.000Z","depth":0,"epoch":3,"id":"thread-1:1","prevHash":"0000000000000000000000000000000000000000000000000000000000000000","runId":"run-1","seq":1,"text":"m0","threadId":"thread-1","type":"user-said"}',
    )
    expect(decodeStoredEvent(stored)).toEqual(event!)
  })

  it('writes the empty visibility state canonically', () => {
    expect(EMPTY_VISIBILITY_TEXT).toBe('{"spans":[]}')
  })
})
