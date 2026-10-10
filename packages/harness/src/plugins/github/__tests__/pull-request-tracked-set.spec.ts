import { describe, expect, it } from 'bun:test'

import {
  checkoutKey,
  EChecksState,
  NO_PULL_REQUEST_READING,
  POLL_FLOOR_MS,
  POLL_RUNNING_MS,
} from '../pure'
import { createPullRequestService } from '../pull-request-service'
import {
  aCheckout,
  pullRequestsByKey,
  stoppedClock as clock,
  suspendedPort,
  wasFound as found,
} from '../testing'

const MAIN = aCheckout({ directory: '/main', branch: 'dennis/main' })
const MATE = aCheckout({ directory: '/mate', branch: 'dennis/mate' })

const portFor = () =>
  pullRequestsByKey({
    [checkoutKey(MAIN)]: found({ number: 1, checks: EChecksState.None }),
    [checkoutKey(MATE)]: found({ number: 2, checks: EChecksState.None }),
  })

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

describe('tracking a set of checkouts', () => {
  it('reads and publishes every tracked checkout under its own key', async () => {
    const service = createPullRequestService({ pullRequests: portFor() })

    service.track({ checkouts: [MAIN, MATE] })
    await sleep(10)

    expect(service.snapshot({ key: checkoutKey(MAIN) })).toEqual(
      found({ number: 1, checks: EChecksState.None }),
    )
    expect(service.snapshot({ key: checkoutKey(MATE) })).toEqual(
      found({ number: 2, checks: EChecksState.None }),
    )
    expect(service.tracked()).toEqual([MAIN, MATE])
    expect(service.states().map((state) => state.number).sort()).toEqual([1, 2])
    service.dispose()
  })

  it('asks only about a checkout the set gains, not the ones it already held', async () => {
    const port = portFor()
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [MAIN] })
    await sleep(10)
    service.track({ checkouts: [MAIN, MATE] })
    await sleep(10)

    expect(port.asked).toEqual([checkoutKey(MAIN), checkoutKey(MATE)])
    service.dispose()
  })

  it('forgets only the checkout the set loses', async () => {
    const service = createPullRequestService({ pullRequests: portFor() })
    service.track({ checkouts: [MAIN, MATE] })
    await sleep(10)

    service.track({ checkouts: [MAIN] })

    expect(service.snapshot({ key: checkoutKey(MATE) })).toEqual(NO_PULL_REQUEST_READING)
    expect(service.snapshot({ key: checkoutKey(MAIN) }).lookup).not.toBe(
      NO_PULL_REQUEST_READING.lookup,
    )
    service.dispose()
  })

  it('drops a read still in flight for a lost checkout instead of resurrecting it', async () => {
    const { port, gate } = suspendedPort()
    const service = createPullRequestService({ pullRequests: port })

    service.track({ checkouts: [MATE] })
    service.track({ checkouts: [] })
    gate.settle?.(found({ number: 2 }))
    await sleep(10)

    expect(service.snapshot({ key: checkoutKey(MATE) })).toEqual(NO_PULL_REQUEST_READING)
    service.dispose()
  })

  it('keeps the timer alive for the checkouts that remain', async () => {
    const port = portFor()
    const time = clock(1_000_000)
    const service = createPullRequestService({ pullRequests: port, now: time.now, tickMs: 1 })
    service.track({ checkouts: [MAIN, MATE] })
    await sleep(10)

    service.track({ checkouts: [MAIN] })
    time.advance(60 * 60_000)
    await sleep(20)

    expect(port.asked.filter((key) => key === checkoutKey(MAIN)).length).toBeGreaterThan(1)
    expect(port.asked.filter((key) => key === checkoutKey(MATE))).toHaveLength(1)
    service.dispose()
  })
})

describe('the visible checkout', () => {
  it('defaults to the first tracked and follows an explicit choice', async () => {
    const service = createPullRequestService({ pullRequests: portFor() })

    service.track({ checkouts: [MAIN, MATE] })
    expect(service.current()?.checkout).toEqual(MAIN)

    service.setVisible({ checkout: MATE })
    expect(service.current()?.checkout).toEqual(MATE)
    service.dispose()
  })

  it('moves off a checkout the set loses', async () => {
    const service = createPullRequestService({ pullRequests: portFor() })
    service.track({ checkouts: [MAIN, MATE], visible: MATE })

    service.track({ checkouts: [MAIN] })

    expect(service.current()?.checkout).toEqual(MAIN)
    service.dispose()
  })

  it('notifies subscribers when only the visible choice changed', () => {
    const service = createPullRequestService({ pullRequests: portFor() })
    service.track({ checkouts: [MAIN, MATE] })
    const before = service.version()

    service.setVisible({ checkout: MATE })

    expect(service.version()).toBeGreaterThan(before)
    service.dispose()
  })
})

describe('an expecting window per checkout', () => {
  it('opens a window for the named checkout only', async () => {
    const port = portFor()
    const time = clock(1_000_000)
    const service = createPullRequestService({ pullRequests: port, now: time.now })
    service.track({ checkouts: [MAIN, MATE] })
    await sleep(10)
    expect(port.asked).toHaveLength(2)

    time.advance(POLL_FLOOR_MS)
    service.expectChecks({ checkout: MATE })
    await sleep(10)
    time.advance(POLL_RUNNING_MS)
    await service.refresh({ checkout: MAIN })
    await service.refresh({ checkout: MATE })

    expect(port.asked.filter((key) => key === checkoutKey(MATE))).toHaveLength(3)
    expect(port.asked.filter((key) => key === checkoutKey(MAIN))).toHaveLength(1)
    service.dispose()
  })

  it('reads only the named checkout at once on a push', async () => {
    const port = portFor()
    const time = clock(1_000_000)
    const service = createPullRequestService({ pullRequests: port, now: time.now })
    service.track({ checkouts: [MAIN, MATE] })
    await sleep(10)

    time.advance(POLL_FLOOR_MS)
    service.expectChecks({ checkout: MATE })
    await sleep(10)

    expect(port.asked).toEqual([
      checkoutKey(MAIN),
      checkoutKey(MATE),
      checkoutKey(MATE),
    ])
    service.dispose()
  })

  it('ignores a recheck for a checkout nothing tracks', async () => {
    const port = portFor()
    const service = createPullRequestService({ pullRequests: port })
    service.track({ checkouts: [MAIN] })
    await sleep(10)

    service.recheck({ checkout: MATE })
    await sleep(10)

    expect(port.asked).toEqual([checkoutKey(MAIN)])
    service.dispose()
  })

  it('forgets a window when its checkout leaves the set', async () => {
    const port = portFor()
    const time = clock(1_000_000)
    const service = createPullRequestService({ pullRequests: port, now: time.now })
    service.track({ checkouts: [MATE] })
    await sleep(10)
    service.expectChecks({ checkout: MATE })
    service.track({ checkouts: [] })

    service.track({ checkouts: [MATE] })
    await sleep(10)
    time.advance(POLL_RUNNING_MS)
    await service.refresh({ checkout: MATE })

    expect(port.asked.filter((key) => key === checkoutKey(MATE))).toHaveLength(2)
    service.dispose()
  })
})

