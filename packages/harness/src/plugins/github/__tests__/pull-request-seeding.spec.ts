import { describe, expect, it } from 'bun:test'

import {
  checkoutKey,
  NO_PULL_REQUEST_READING,
  PullRequestPort,
  pullRequestBadgeKeyString,
  type PullRequestBadgeKey,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../pure'

import { createPullRequestService } from '../pull-request-service'
import {
  aCheckout,
  aLink,
  stoppedClock as clock,
  suspendedPort,
  wasFound as found,
} from '../testing'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const LINK_KEY = 'github.com/dennisofficial/atlas#42'

const cachedPort = (args: {
  cached: Readonly<Record<string, PullRequestReading>>
  live: PullRequestReading
}): PullRequestPort =>
  new (class extends PullRequestPort {
    readonly pushes = false

    async read(): Promise<PullRequestReading> {
      return args.live
    }

    async readLinked(): Promise<PullRequestReading> {
      return args.live
    }

    override peekBadge(key: PullRequestBadgeKey): PullRequestReading | null {
      return args.cached[pullRequestBadgeKeyString(key)] ?? null
    }
  })()

describe('seeding readings from the badge cache', () => {
  it('shows the cached reading the moment a checkout is tracked, before the live read lands', async () => {
    const checkout = aCheckout()
    const { port: live, gate } = suspendedPort()
    const cached = found({ number: 33 })
    const port = new (class extends PullRequestPort {
      readonly pushes = false
      async read(): Promise<PullRequestReading> {
        return live.read()
      }
      async readLinked(): Promise<PullRequestReading> {
        return NO_PULL_REQUEST_READING
      }
      override peekBadge(key: PullRequestBadgeKey): PullRequestReading | null {
        return key.kind === 'checkout' ? cached : null
      }
    })()
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [checkout] })

    expect(service.snapshot({ key: checkoutKey(checkout) })).toEqual(cached)

    gate.settle?.(found({ number: 33 }))
    await sleep(10)
    service.dispose()
  })

  it('lets the live answer replace the seed when it lands', async () => {
    const checkout = aCheckout()
    const port = cachedPort({
      cached: { [checkoutKey(checkout)]: found({ number: 33 }) },
      live: found({ number: 34 }),
    })
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [checkout] })
    await sleep(10)

    expect(service.snapshot({ key: checkoutKey(checkout) })).toEqual(found({ number: 34 }))
    service.dispose()
  })

  it('never lets a seed overwrite an answer the service already holds', async () => {
    const checkout = aCheckout()
    const port = cachedPort({
      cached: { [checkoutKey(checkout)]: found({ number: 33 }) },
      live: found({ number: 34 }),
    })
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [checkout] })
    await sleep(10)

    service.track({ checkouts: [checkout], visible: checkout })
    await sleep(10)

    expect(service.snapshot({ key: checkoutKey(checkout) })).toEqual(found({ number: 34 }))
    service.dispose()
  })

  it('seeds the checkout that becomes visible', () => {
    const main = aCheckout({ directory: '/main', branch: 'dennis/main' })
    const mate = aCheckout({ directory: '/mate', branch: 'dennis/mate' })
    const port = new (class extends PullRequestPort {
      readonly pushes = false
      async read({ checkout }: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
        return checkout.directory === '/main' ? found({ number: 1 }) : NO_PULL_REQUEST_READING
      }
      async readLinked(): Promise<PullRequestReading> {
        return NO_PULL_REQUEST_READING
      }
      override peekBadge(key: PullRequestBadgeKey): PullRequestReading | null {
        if (key.kind !== 'checkout') return null
        return key.checkout.directory === '/mate' ? found({ number: 2 }) : null
      }
    })()
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [main, mate], visible: main })
    service.setVisible({ checkout: mate })

    expect(service.current()?.reading).toEqual(found({ number: 2 }))
    service.dispose()
  })

  it('seeds a watched link from its linked badge key', () => {
    const port = cachedPort({
      cached: { [LINK_KEY]: found() },
      live: NO_PULL_REQUEST_READING,
    })
    const service = createPullRequestService({ pullRequests: port })

    service.watch({ links: [aLink()] })

    expect(service.snapshot({ key: LINK_KEY })).toEqual(found())
    service.dispose()
  })

  it('seeds nothing for a key the cache has never seen', () => {
    const checkout = aCheckout()
    const port = cachedPort({ cached: {}, live: NO_PULL_REQUEST_READING })
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [checkout] })

    expect(service.snapshot({ key: checkoutKey(checkout) })).toEqual(NO_PULL_REQUEST_READING)
    service.dispose()
  })

  it('still refetches a seeded key on the poll cadence', async () => {
    const checkout = aCheckout()
    const time = clock(1_000_000)
    let liveCalls = 0
    const port = new (class extends PullRequestPort {
      readonly pushes = false
      async read(): Promise<PullRequestReading> {
        liveCalls += 1
        return found({ number: 33 })
      }
      async readLinked(): Promise<PullRequestReading> {
        return NO_PULL_REQUEST_READING
      }
      override peekBadge(key: PullRequestBadgeKey): PullRequestReading | null {
        return key.kind === 'checkout' ? found({ number: 33 }) : null
      }
    })()
    const service = createPullRequestService({ pullRequests: port, now: time.now, tickMs: 1 })

    service.track({ checkouts: [checkout] })
    await sleep(10)
    const afterFirst = liveCalls
    expect(afterFirst).toBeGreaterThan(0)

    time.advance(60 * 60_000)
    await sleep(20)

    expect(liveCalls).toBeGreaterThan(afterFirst)
    service.dispose()
  })
})
