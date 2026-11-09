import { describe, expect, it } from 'bun:test'
import {
  formatPresence,
  isWatchingThread,
  parsePresence,
  parsePresenceHash,
  PRESENCE_STALE_MS,
} from './presence-entries'

describe('presence entries', () => {
  it('round-trips a thread sighting through the stored form', () => {
    const raw = formatPresence({ threadId: 'thr-1', at: 1760000000000 })

    expect(parsePresence({ clientId: 'cli-1', raw })).toEqual({
      clientId: 'cli-1',
      threadId: 'thr-1',
      at: 1760000000000,
    })
  })

  it('keeps pipes inside a thread id', () => {
    const raw = formatPresence({ threadId: 'thr|1', at: 5 })

    expect(parsePresence({ clientId: 'cli-1', raw })?.threadId).toBe('thr|1')
  })

  it('ignores a malformed value instead of failing the read', () => {
    expect(parsePresence({ clientId: 'cli-1', raw: 'nonsense' })).toBeUndefined()
    expect(parsePresence({ clientId: 'cli-1', raw: '12|' })).toBeUndefined()
    expect(parsePresenceHash({ 'cli-1': 'nonsense', 'cli-2': '9|thr-1' })).toEqual([
      { clientId: 'cli-2', threadId: 'thr-1', at: 9 },
    ])
  })

  it('counts a fresh sighting of the same thread', () => {
    const now = 1_000_000

    expect(
      isWatchingThread({
        entries: [{ clientId: 'cli-1', threadId: 'thr-1', at: now - 1_000 }],
        threadId: 'thr-1',
        now,
      }),
    ).toBe(true)
  })

  it('ignores a sighting of another thread', () => {
    const now = 1_000_000
    const entries = [{ clientId: 'cli-1', threadId: 'thr-2', at: now }]

    expect(isWatchingThread({ entries, threadId: 'thr-1', now })).toBe(false)
  })

  it('ignores a sighting older than the stale window', () => {
    const now = 1_000_000
    const entries = [{ clientId: 'cli-1', threadId: 'thr-1', at: now - PRESENCE_STALE_MS - 1 }]

    expect(isWatchingThread({ entries, threadId: 'thr-1', now })).toBe(false)
  })
})
