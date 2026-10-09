import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EPullRequestLookup,
  EPullRequestState,
  EChecksState,
  NO_CHECKS,
  type PullRequestReading,
} from '../pure'
import {
  createPullRequestCache,
  PULL_REQUEST_CACHE_ABSENT_TTL_MS,
  PULL_REQUEST_CACHE_ACTIVE_TTL_MS,
  PULL_REQUEST_CACHE_FAILURE_TTL_MS,
  PULL_REQUEST_CACHE_SETTLED_TTL_MS,
} from '../pull-request-cache'

const found = (args: { number: number; state?: EPullRequestState }): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: args.number,
    title: 'a pull request',
    url: `https://github.com/dennis/atlas/pull/${args.number}`,
    state: args.state ?? EPullRequestState.Open,
    checks: EChecksState.None,
    tally: NO_CHECKS,
    mergeable: null, comments: [], reviews: [],
  },
})

const ABSENT: PullRequestReading = { lookup: EPullRequestLookup.Absent }

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createPullRequestCache', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const cacheIn = (now: () => number) => {
    dir = mkdtempSync(join(tmpdir(), 'pr-cache-'))
    return { cache: createPullRequestCache({ file: join(dir, 'pull-request-badges.json'), now }), dir }
  }

  it('answers null for a key it has never held', () => {
    const { cache } = cacheIn(() => 0)
    expect(cache.peek({ key: 'github.com/dennis/atlas#main' })).toBeNull()
  })

  it('paints a freshened reading and fires subscribers', async () => {
    const { cache } = cacheIn(() => 1000)
    const seen: string[] = []
    cache.subscribe(() => seen.push('hit'))

    cache.freshen({ key: 'k1', ask: async () => found({ number: 1 }) })
    await flush()

    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 1 }))
    expect(seen.length).toBeGreaterThan(0)
  })

  it('dedupes repeated freshen calls for one key while a read is in flight', async () => {
    const { cache } = cacheIn(() => 0)
    const gate = deferred<PullRequestReading>()
    let asked = 0

    cache.freshen({ key: 'k1', ask: () => { asked += 1; return gate.promise } })
    cache.freshen({ key: 'k1', ask: () => { asked += 1; return gate.promise } })
    cache.freshen({ key: 'k1', ask: () => { asked += 1; return gate.promise } })
    expect(asked).toBe(1)

    gate.resolve(found({ number: 2 }))
    await flush()
    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 2 }))
  })

  it('holds the last known value when a freshen rejects, without refreshing the timestamp', async () => {
    let now = 1000
    const { cache } = cacheIn(() => now)

    cache.freshen({ key: 'k1', ask: async () => found({ number: 3 }) })
    await flush()

    const file = join(dir, 'pull-request-badges.json')
    const before = readFileSync(file, 'utf8')

    now = 1000 + PULL_REQUEST_CACHE_ACTIVE_TTL_MS + 1
    cache.freshen({ key: 'k1', ask: async () => { throw new Error('offline') } })
    await flush()

    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 3 }))
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('treats an Unavailable answer as a failure: keeps the last good reading, backs off briefly, then asks again', async () => {
    let now = 1000
    const { cache } = cacheIn(() => now)

    cache.freshen({ key: 'k1', ask: async () => found({ number: 4 }) })
    await flush()

    now = 1000 + PULL_REQUEST_CACHE_ACTIVE_TTL_MS + 1
    cache.freshen({ key: 'k1', ask: async () => ({ lookup: EPullRequestLookup.Unavailable, retryable: true }) })
    await flush()

    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 4 }))

    let askedAgain = false
    cache.freshen({ key: 'k1', ask: async () => { askedAgain = true; return found({ number: 5 }) } })
    await flush()
    expect(askedAgain).toBe(false)
    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 4 }))

    now += PULL_REQUEST_CACHE_FAILURE_TTL_MS + 1
    cache.freshen({ key: 'k1', ask: async () => { askedAgain = true; return found({ number: 5 }) } })
    await flush()
    expect(askedAgain).toBe(true)
    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 5 }))
  })

  it('reloads from disk so a restarted run paints instantly', async () => {
    const first = cacheIn(() => 1000)
    first.cache.freshen({ key: 'k1', ask: async () => found({ number: 6 }) })
    first.cache.freshen({ key: 'k2', ask: async () => ABSENT })
    await flush()

    const second = createPullRequestCache({ file: join(first.dir, 'pull-request-badges.json'), now: () => 1000 })
    expect(second.peek({ key: 'k1' })).toEqual(found({ number: 6 }))
    expect(second.peek({ key: 'k2' })).toEqual(ABSENT)
  })

  it('ignores a corrupt file rather than failing construction', () => {
    dir = mkdtempSync(join(tmpdir(), 'pr-cache-'))
    const file = join(dir, 'pull-request-badges.json')
    writeFileSync(file, 'not json at all')

    const cache = createPullRequestCache({ file, now: () => 0 })
    expect(cache.peek({ key: 'k1' })).toBeNull()
  })

  it('respects the absent TTL: an absent reading is re-asked soon, an active one is held', async () => {
    let now = 2000
    const { cache } = cacheIn(() => now)

    cache.freshen({ key: 'absent', ask: async () => ABSENT })
    cache.freshen({ key: 'active', ask: async () => found({ number: 7 }) })
    await flush()

    now += PULL_REQUEST_CACHE_ABSENT_TTL_MS + 1

    let absentAsked = false
    let activeAsked = false
    cache.freshen({ key: 'absent', ask: async () => { absentAsked = true; return ABSENT } })
    cache.freshen({ key: 'active', ask: async () => { activeAsked = true; return found({ number: 8 }) } })
    await flush()

    expect(absentAsked).toBe(true)
    expect(activeAsked).toBe(false)
  })

  it('holds a settled reading far longer than an active one', async () => {
    let now = 5000
    const { cache } = cacheIn(() => now)

    cache.freshen({ key: 'merged', ask: async () => found({ number: 9, state: EPullRequestState.Merged }) })
    await flush()

    now += PULL_REQUEST_CACHE_ACTIVE_TTL_MS + 1
    let asked = false
    cache.freshen({ key: 'merged', ask: async () => { asked = true; return found({ number: 9, state: EPullRequestState.Merged }) } })
    await flush()
    expect(asked).toBe(false)

    now += PULL_REQUEST_CACHE_SETTLED_TTL_MS
    cache.freshen({ key: 'merged', ask: async () => { asked = true; return found({ number: 9, state: EPullRequestState.Merged }) } })
    await flush()
    expect(asked).toBe(true)
  })

  it('ingest keeps the timestamp when the push repeats the held reading', async () => {
    let now = 9000
    const { cache } = cacheIn(() => now)

    cache.freshen({ key: 'k1', ask: async () => found({ number: 10 }) })
    await flush()

    now += PULL_REQUEST_CACHE_ACTIVE_TTL_MS + 1
    cache.ingest({ key: 'k1', reading: found({ number: 10 }) })

    let asked = false
    cache.freshen({ key: 'k1', ask: async () => { asked = true; return found({ number: 11 }) } })
    await flush()
    expect(asked).toBe(true)
    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 11 }))
  })

  it('a changed push is fresh: it answers the key again only after the active TTL', async () => {
    let now = 9000
    const { cache } = cacheIn(() => now)

    cache.freshen({ key: 'k1', ask: async () => found({ number: 10 }) })
    await flush()

    now += PULL_REQUEST_CACHE_ACTIVE_TTL_MS + 1
    cache.ingest({ key: 'k1', reading: found({ number: 11 }) })
    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 11 }))

    let asked = false
    cache.freshen({ key: 'k1', ask: async () => { asked = true; return found({ number: 12 }) } })
    await flush()
    expect(asked).toBe(false)

    now += PULL_REQUEST_CACHE_ACTIVE_TTL_MS + 1
    cache.freshen({ key: 'k1', ask: async () => { asked = true; return found({ number: 12 }) } })
    await flush()
    expect(asked).toBe(true)
  })

  it('a failed save does not spin: later writes hold until a new reading lands', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pr-cache-'))
    const blocked = join(dir, 'no-such-parent', 'deeper', 'pull-request-badges.json')
    const cache = createPullRequestCache({ file: blocked, now: () => 0 })

    cache.ingest({ key: 'k1', reading: found({ number: 30 }) })
    cache.ingest({ key: 'k1', reading: found({ number: 31 }) })
    cache.ingest({ key: 'k1', reading: found({ number: 32 }) })
    await flush()

    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 32 }))
  })

  it('a read started before a push cannot overwrite the pushed reading', async () => {
    let now = 9000
    const { cache } = cacheIn(() => now)

    const gate = deferred<PullRequestReading>()
    cache.freshen({ key: 'k1', ask: () => gate.promise })
    await Promise.resolve()

    now += 100
    cache.ingest({ key: 'k1', reading: found({ number: 20 }) })
    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 20 }))

    gate.resolve(found({ number: 10 }))
    await flush()

    expect(cache.peek({ key: 'k1' })).toEqual(found({ number: 20 }))
  })
})
