import { describe, expect, it } from 'bun:test'

import { startServeIdleStop } from '../idle-stop'

const idleHarness = (over: {
  turnRunning?: boolean
  childrenSettling?: boolean
  runningShells?: number
  runningServices?: number
  probeFails?: () => boolean
}) => {
  let now = 1_000_000
  const due: number[] = []
  const logged: string[] = []
  const stop = startServeIdleStop({
    turnRunning: () => {
      if (over.probeFails?.() === true) throw new Error('probe exploded')
      return over.turnRunning ?? false
    },
    childrenSettling: () => over.childrenSettling ?? false,
    runningShells: () => over.runningShells ?? 0,
    runningServices: () => over.runningServices ?? 0,
    onDue: () => due.push(now),
    idleMinutes: 5,
    idleMinutesWithServices: 30,
    tickMs: 5,
    now: () => now,
    log: (line) => logged.push(line),
  })
  return {
    stop,
    due,
    logged,
    advance: (ms: number) => {
      now += ms
    },
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('startServeIdleStop', () => {
  it('fires once the quiet window has passed', async () => {
    const test = idleHarness({})

    test.advance(5 * 60_000)
    await sleep(25)

    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('stays quiet while a turn is running, and notes push the window out', async () => {
    const test = idleHarness({ turnRunning: true })

    test.advance(60 * 60_000)
    await sleep(25)
    expect(test.due).toHaveLength(0)

    test.stop.halt()
  })

  it('stretches the window while a service is running', async () => {
    const test = idleHarness({ runningServices: 1 })

    test.advance(5 * 60_000)
    await sleep(25)
    expect(test.due).toHaveLength(0)

    test.advance(25 * 60_000)
    await sleep(25)
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('a note restarts the window', async () => {
    const test = idleHarness({})

    test.advance(4 * 60_000)
    test.stop.note()
    test.advance(4 * 60_000)
    await sleep(25)
    expect(test.due).toHaveLength(0)

    test.advance(60_000)
    await sleep(25)
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('fires once, never twice', async () => {
    const test = idleHarness({})

    test.advance(60 * 60_000)
    await sleep(40)

    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })

  it('logs a throwing probe and still parks once it recovers', async () => {
    let failing = true
    const test = idleHarness({ probeFails: () => failing })

    test.advance(60 * 60_000)
    await sleep(25)
    expect(test.due).toHaveLength(0)
    expect(test.logged.length).toBeGreaterThan(0)
    expect(test.logged[0]).toContain('probe exploded')

    failing = false
    await sleep(25)
    expect(test.due).toHaveLength(1)
    test.stop.halt()
  })
})
