import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import { sha256Hex, transcriptIdentityDigest, type EventIdentity } from '../event-identity'
import { findDivergence, prefixDigestOf } from '../reconcile'

const remoteDigestOver =
  (remote: readonly EventIdentity[]) =>
  async (upTo: number): Promise<{ count: number; digest: string }> => {
    const prefix = remote.filter((event) => event.seq <= upTo)
    return { count: prefix.length, digest: prefixDigestOf({ events: prefix, upTo }) }
  }

const remote = [
  { id: 'r1', seq: 1, type: 'user-said' },
  { id: 'r2', seq: 2, type: 'assistant-said' },
  { id: 'r3', seq: 3, type: 'user-said' },
  { id: 'r4', seq: 4, type: 'assistant-said' },
  { id: 'r5', seq: 5, type: 'user-said' },
]

describe('sha256Hex', () => {
  it('matches node:crypto on the empty string', () => {
    expect(sha256Hex(new TextEncoder().encode(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches node:crypto on short and multi-chunk inputs', () => {
    for (const text of ['abc', 'a'.repeat(200), JSON.stringify(remote)]) {
      const bytes = new TextEncoder().encode(text)
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
  })
})

describe('transcriptIdentityDigest', () => {
  it('matches node:crypto sha256 over the seq-sorted identity triples', () => {
    const identities = remote.map((event) => [event.id, event.seq, event.type])
    const expected = createHash('sha256').update(JSON.stringify(identities)).digest('hex')
    expect(transcriptIdentityDigest(remote)).toBe(expected)
  })
})

describe('prefixDigestOf', () => {
  it('digests only events at or below upTo', () => {
    expect(prefixDigestOf({ events: remote, upTo: 3 })).toBe(transcriptIdentityDigest(remote.slice(0, 3)))
  })

  it('is unaffected by events above upTo', () => {
    expect(prefixDigestOf({ events: remote, upTo: 9 })).toBe(transcriptIdentityDigest(remote))
  })

  it('ignores order and non-identity fields', () => {
    const reversed = [...remote].reverse()
    expect(prefixDigestOf({ events: reversed, upTo: 5 })).toBe(prefixDigestOf({ events: remote, upTo: 5 }))
  })
})

describe('findDivergence', () => {
  it('returns null when local is in sync with remote', async () => {
    const found = await findDivergence({ local: remote, remoteDigest: remoteDigestOver(remote) })
    expect(found).toBeNull()
  })

  it('returns null when remote is append-only ahead of local', async () => {
    const local = remote.slice(0, 3)
    const found = await findDivergence({ local, remoteDigest: remoteDigestOver(remote) })
    expect(found).toBeNull()
  })

  it('returns remote count + 1 when the remote was truncated', async () => {
    const truncated = remote.slice(0, 3)
    const found = await findDivergence({ local: remote, remoteDigest: remoteDigestOver(truncated) })
    expect(found).toBe(4)
  })

  it('returns the exact seq of a mid rewrite', async () => {
    const rewritten = remote.map((event) =>
      event.seq === 3 ? { ...event, id: 'r3-replaced' } : event,
    )
    const found = await findDivergence({ local: remote, remoteDigest: remoteDigestOver(rewritten) })
    expect(found).toBe(3)
  })

  it('returns 1 after a full replace', async () => {
    const replaced = remote.map((event, index) => ({ ...event, id: `fresh-${index + 1}` }))
    const found = await findDivergence({ local: remote, remoteDigest: remoteDigestOver(replaced) })
    expect(found).toBe(1)
  })

  it('returns null when both logs are empty', async () => {
    const found = await findDivergence({ local: [], remoteDigest: remoteDigestOver([]) })
    expect(found).toBeNull()
  })

  it('returns 1 when local is empty but remote holds events', async () => {
    const found = await findDivergence({ local: [], remoteDigest: remoteDigestOver(remote) })
    expect(found).toBe(1)
  })

  it('returns 1 when remote is empty but local holds events', async () => {
    const found = await findDivergence({ local: remote, remoteDigest: remoteDigestOver([]) })
    expect(found).toBe(1)
  })

  it('localizes a rewrite with O(log n) remote probes', async () => {
    let probes = 0
    const countingDigest = async (upTo: number): Promise<{ count: number; digest: string }> => {
      probes += 1
      return remoteDigestOver(remote)(upTo)
    }
    const rewritten = remote.map((event) =>
      event.seq === 4 ? { ...event, id: 'r4-replaced' } : event,
    )
    const found = await findDivergence({ local: rewritten, remoteDigest: countingDigest })
    expect(found).toBe(4)
    expect(probes).toBeLessThanOrEqual(1 + Math.ceil(Math.log2(remote.length)))
  })
})
