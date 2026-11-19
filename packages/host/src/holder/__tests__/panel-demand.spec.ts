import { describe, expect, it } from 'bun:test'

import { idleReleaseDue } from '../held-idle'
import { PanelDemand } from '../panel-demand'
import type { SessionRuntime } from '../ports'

const SESSION = 'ses_1'

const runtime = {} as SessionRuntime

const sleep = (ms: number): Promise<void> => Bun.sleep(ms)

describe('PanelDemand', () => {
  it('arms a hold and asks for work once, however many heartbeats arrive', () => {
    const worked: string[] = []
    const demand = new PanelDemand()
    demand.observe({ onWork: (id) => worked.push(id), onIdle: () => undefined })

    demand.hold({ sessionId: SESSION })
    demand.hold({ sessionId: SESSION })

    expect(demand.countOf(SESSION)).toBe(1)
    expect(worked).toEqual([SESSION])
  })

  it('expires a hold nobody renewed, and reports it idle once', async () => {
    const idle: string[] = []
    const demand = new PanelDemand()
    demand.observe({ onWork: () => undefined, onIdle: (id) => idle.push(id) })

    demand.hold({ sessionId: SESSION, ttlMs: 40 })
    await sleep(20)
    expect(demand.countOf(SESSION)).toBe(1)
    await sleep(60)

    expect(demand.countOf(SESSION)).toBe(0)
    expect(idle).toEqual([SESSION])
  })

  it('keeps a renewed hold alive past the deadline the first one set', async () => {
    const idle: string[] = []
    const demand = new PanelDemand()
    demand.observe({ onWork: () => undefined, onIdle: (id) => idle.push(id) })

    demand.hold({ sessionId: SESSION, ttlMs: 150 })
    await sleep(100)
    demand.hold({ sessionId: SESSION, ttlMs: 150 })
    await sleep(100)

    expect(demand.countOf(SESSION)).toBe(1)
    expect(idle).toEqual([])

    await sleep(100)
    expect(idle).toEqual([SESSION])
  })

  it('drops a hold on request', () => {
    const idle: string[] = []
    const demand = new PanelDemand()
    demand.observe({ onWork: () => undefined, onIdle: (id) => idle.push(id) })

    demand.hold({ sessionId: SESSION })
    expect(demand.release(SESSION)).toBe(true)
    expect(demand.countOf(SESSION)).toBe(0)
    expect(demand.release(SESSION)).toBe(false)
    expect(idle).toEqual([SESSION])
  })
})

describe('idleReleaseDue with a panel hold', () => {
  const quiet = (panelHolds: number): boolean =>
    idleReleaseDue({
      turnRunning: false,
      runtime,
      pendingInput: false,
      runningShells: 0,
      runningChildren: 0,
      terminalStreams: 0,
      panelHolds,
    })

  it('keeps a session whose files or terminal panel is open', () => {
    expect(quiet(1)).toBe(false)
  })

  it('releases once the panel hold expires', () => {
    expect(quiet(0)).toBe(true)
  })
})
