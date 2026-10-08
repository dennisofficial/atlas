import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CachedPullRequestPort, PULL_REQUEST_PORT_CONCURRENCY } from '../pull-request-cache-port'
import {
  checkoutKey,
  EForge,
  EPullRequestLookup,
  EPullRequestState,
  EChecksState,
  NO_CHECKS,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'

const checkout = (args: { branch: string; directory?: string }): RepositoryCheckout => ({
  directory: args.directory ?? '/repo',
  branch: args.branch,
  forge: EForge.GitHub,
  remote: { host: 'github.com', owner: 'dennis', repo: 'atlas' },
})

const found = (args: { number: number }): PullRequestReading => ({
  lookup: EPullRequestLookup.Found,
  pullRequest: {
    number: args.number,
    title: 'a pull request',
    url: `https://github.com/dennis/atlas/pull/${args.number}`,
    state: EPullRequestState.Open,
    checks: EChecksState.None,
    tally: NO_CHECKS,
    mergeable: null, comments: [], reviews: [],
  },
})

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

class ScriptedPullRequests extends PullRequestPort {
  readonly pushes = false
  readonly reads: string[] = []
  readonly linkedReads: string[] = []
  gate: ((key: string) => Promise<PullRequestReading> | null) | null = null

  constructor(private readonly answer: (key: string) => PullRequestReading) {
    super()
  }

  async read(request: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
    const key = checkoutKey(request.checkout)
    this.reads.push(key)
    const gated = this.gate?.(key)
    if (gated !== null && gated !== undefined) return gated
    return this.answer(key)
  }

  async readLinked(args: { repo: string; number: number }): Promise<PullRequestReading> {
    const key = `${args.repo}#${args.number}`
    this.linkedReads.push(key)
    const gated = this.gate?.(key)
    if (gated !== null && gated !== undefined) return gated
    return this.answer(key)
  }
}

describe('CachedPullRequestPort', () => {
  it('serves a freshened badge from peek without another read', async () => {
    const inner = new ScriptedPullRequests(() => found({ number: 1 }))
    const port = new CachedPullRequestPort({ inner, file: join(mkdtempSync(join(tmpdir(), 'pr-port-')), 'badges.json') })

    port.freshenBadge({ kind: 'checkout', checkout: checkout({ branch: 'main' }) })
    await flush()

    expect(port.peekBadge({ kind: 'checkout', checkout: checkout({ branch: 'main' }) })).toEqual(
      found({ number: 1 }),
    )
    port.dispose()
  })

  it('bounds concurrency so a burst of reads never runs more than the cap at once', async () => {
    let running = 0
    let peak = 0
    const inner = new (class extends PullRequestPort {
      readonly pushes = false
      async read(request: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running -= 1
        return found({ number: request.checkout.branch.length })
      }
      async readLinked(): Promise<PullRequestReading> {
        return { lookup: EPullRequestLookup.Absent }
      }
    })()
    const port = new CachedPullRequestPort({ inner, file: join(mkdtempSync(join(tmpdir(), 'pr-port-')), 'badges.json') })

    const branches = Array.from({ length: PULL_REQUEST_PORT_CONCURRENCY * 3 }, (_, i) => `b${i}`)
    await Promise.all(
      branches.map((branch) => port.read({ checkout: checkout({ branch }) })),
    )

    expect(peak).toBeLessThanOrEqual(PULL_REQUEST_PORT_CONCURRENCY)
    port.dispose()
  })

  it('a slow read does not hold the badges of other rows hostage', async () => {
    const slow = deferred<PullRequestReading>()
    const inner = new ScriptedPullRequests(() => found({ number: 2 }))
    inner.gate = (key) => (key.includes('slow') ? slow.promise : null)
    const port = new CachedPullRequestPort({ inner, file: join(mkdtempSync(join(tmpdir(), 'pr-port-')), 'badges.json') })

    port.freshenBadge({ kind: 'checkout', checkout: checkout({ branch: 'slow', directory: '/slow' }) })
    await Promise.resolve()

    const fastCheckout = checkout({ branch: 'fast', directory: '/fast' })
    const fastReading = await port.read({ checkout: fastCheckout })
    expect(fastReading.lookup).toBe(EPullRequestLookup.Found)

    slow.resolve(found({ number: 99 }))
    await flush()
    port.dispose()
  })
})
