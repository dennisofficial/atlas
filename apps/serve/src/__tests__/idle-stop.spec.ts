import { describe, expect, it } from 'bun:test'

import { startServeIdleStop } from '../idle-stop'

type Probes = {
  turnRunning: boolean
  runningChildren: number
  childrenSettling: boolean
  runningShells: number
  runningServices: number
  pendingInput: boolean
  clientsAttached: number
  probeFails: boolean
}

const idleHarness = (probes: Partial<Probes>, tickMs = 60_000) => {
  const live: Probes = {
    turnRunning: false,
    runningChildren: 0,
    childrenSettling: false,
    runningShells: 0,
    runningServices: 0,
    pendingInput: false,
    clientsAttached: 0,
    probeFails: false,
    ...probes,
  }
  let now = 1_000_000
  const due: number[] = []
  const logged: string[] = []
  const stop = startServeIdleStop({
    turnRunning: () => {
      if (live.probeFails) throw new Error('probe exploded')
      return live.turnRunning
    },
    runningChildren: () => live.runningChildren,
    childrenSettling: () => live.childrenSettling,
    runningShells: () => live.runningShells,
    runningServices: () => live.runningServices,
    pendingInput: () => live.pendingInput,
    clientsAttached: () => live.clientsAttached,
    onDue: () => due.push(now),
    idleMinutes: 5,
    serviceIdleMinutes: 30,
    tickMs,
    now: () => now,
    log: (line) => logged.push(line),
  })
  return {
    stop,
    live,
    due,
    logged,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('startServeIdleStop', () => {
  it('parks only after five continuous quiet minutes following long busy work', () => {
    const test = idleHarness({ turnRunning: true })

    test.stop.check()
    test.advance(60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.live.turnRunning = false
    test.stop.check()
    test.advance(5 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('any busy probe during the window restarts the five minutes from zero', () => {
    const test = idleHarness({})

    test.stop.check()
    test.advance(4 * 60_000)
    test.stop.check()

    test.live.pendingInput = true
    test.stop.check()
    test.live.pendingInput = false
    test.stop.check()

    test.advance(4 * 60_000 + 59_999)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('never parks while children are running or settling, however long they run', () => {
    const test = idleHarness({ runningChildren: 2 })

    test.stop.check()
    test.advance(24 * 60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.live.runningChildren = 0
    test.live.childrenSettling = true
    test.advance(24 * 60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)
    test.stop.halt()
  })

  it('queued input blocks the park until it is drained and the window re-runs', () => {
    const test = idleHarness({ pendingInput: true })

    test.stop.check()
    test.advance(60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.live.pendingInput = false
    test.stop.check()
    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('busy work that ends between ticks starts the window at the first quiet tick after it', () => {
    const test = idleHarness({ turnRunning: true })

    test.stop.check()
    test.advance(5 * 60_000)
    test.live.turnRunning = false

    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(5 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a service with a client attached never parks, however long it runs', () => {
    const test = idleHarness({ runningServices: 1, clientsAttached: 1 })

    test.stop.check()
    test.advance(24 * 60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)
    test.stop.halt()
  })

  it('a detached service parks only once the longer service window has passed', () => {
    const test = idleHarness({ runningServices: 1, clientsAttached: 0 })

    test.stop.check()
    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(25 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a client detaching starts the service window fresh from the detach', () => {
    const test = idleHarness({ runningServices: 1, clientsAttached: 1 })

    test.stop.check()
    test.advance(20 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.live.clientsAttached = 0
    test.stop.check()
    test.advance(30 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a silent sandbox parks at the short window even with a client attached', () => {
    const test = idleHarness({ clientsAttached: 1 })

    test.stop.check()
    test.advance(5 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a service stopping with a client attached still demands the full short window', () => {
    const test = idleHarness({ runningServices: 1, clientsAttached: 1 })

    test.stop.check()
    test.advance(60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.live.runningServices = 0
    test.stop.check()
    test.advance(5 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a throwing probe logs, resets the quiet origin, and demands a fresh full window', () => {
    const test = idleHarness({})

    test.stop.check()
    test.advance(4 * 60_000 + 30_000)
    test.stop.check()

    test.live.probeFails = true
    test.stop.check()
    expect(test.due).toHaveLength(0)
    expect(test.logged.length).toBeGreaterThan(0)
    expect(test.logged[0]).toContain('probe exploded')

    test.live.probeFails = false
    test.advance(30_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a note restarts the window', () => {
    const test = idleHarness({})

    test.stop.check()
    test.advance(4 * 60_000)
    test.stop.note()
    test.advance(4 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(0)

    test.advance(60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a refused park rearms through reset and demands a fresh full window', () => {
    const test = idleHarness({})

    test.stop.check()
    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)

    test.stop.reset()
    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)

    test.stop.check()
    test.advance(5 * 60_000 - 1)
    test.stop.check()
    expect(test.due).toHaveLength(1)

    test.advance(1)
    test.stop.check()
    expect(test.due).toHaveLength(2)
    test.stop.halt()
  })

  it('a note after firing does not rearm the stop', () => {
    const test = idleHarness({})

    test.stop.check()
    test.advance(5 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)

    test.stop.note()
    test.advance(60 * 60_000)
    test.stop.check()
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('fires once on the timer, never twice', async () => {
    const test = idleHarness({}, 5)

    test.stop.check()
    test.advance(60 * 60_000)
    await sleep(30)

    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })
})
