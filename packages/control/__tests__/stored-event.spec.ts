import { describe, expect, it } from 'bun:test'
import { chainEvents, chainHash, toRunId, toThreadId, type Hash } from '@dltech/atlas-core'

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

  it('trusts the stored row instead of re-hashing it on read', () => {
    const stored = toStoredEvent({ event: event!, hash: chainHash(event!) })
    const staleHash = 'not-the-digest' as Hash
    expect(decodeStoredEvent({ ...stored, hash: staleHash })).toEqual(event!)
  })

  it('names the event type and the first validation issue when a row does not parse', () => {
    const stored = toStoredEvent({ event: event!, hash: chainHash(event!) })
    const pluginRow = {
      ...stored,
      type: 'mcp-server-changed',
      canonical: stored.canonical.replace('"type":"user-said"', '"type":"mcp-server-changed"'),
    }
    expect(() => decodeStoredEvent(pluginRow)).toThrow(
      /^stored event thread-1:1 is invalid \(type mcp-server-changed; type: Invalid discriminator/,
    )
  })

  it('still refuses a row that disagrees with its columns', () => {
    const stored = toStoredEvent({ event: event!, hash: chainHash(event!) })
    expect(() => decodeStoredEvent({ ...stored, seq: 2 })).toThrow(/disagrees with its row/)
  })
})
