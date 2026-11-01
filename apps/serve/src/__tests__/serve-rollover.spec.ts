import { describe, expect, it } from 'bun:test'

import { createServeRollover, ROLLOVER_REASON } from '../serve-rollover'
import { EServeEvent, type ServeLogLine } from '../serve-log'

const setup = (drain: () => Promise<unknown> = async () => undefined) => {
  const logs: ServeLogLine[] = []
  const rearms: number[] = []
  const drains: string[] = []
  const rollover = createServeRollover({ log: (line) => logs.push(line), sleep: async () => {} })
  rollover.bind({
    drain: async ({ reason }) => {
      drains.push(reason)
      return drain()
    },
    rearm: () => rearms.push(1),
  })
  return { rollover, logs, rearms, drains }
}

describe('serve rollover', () => {
  it('drains once however often it is started', () => {
    const test = setup()
    const request = async () => ({ dispatched: true })
    test.rollover.start(request)
    test.rollover.start(request)
    expect(test.drains).toEqual([ROLLOVER_REASON])
  })

  it('hands off before retire and retries until the API dispatches', async () => {
    const test = setup()
    let calls = 0
    test.rollover.start(async () => {
      calls += 1
      if (calls === 1) throw new Error('control plane down')
      if (calls === 2) return { dispatched: false }
      return { dispatched: true }
    })
    await test.rollover.beforeRetire({ reason: ROLLOVER_REASON })
    expect(calls).toBe(3)
    const events = test.logs.map((line) => line.event)
    expect(events.filter((event) => event === EServeEvent.RolloverHandoffFailed)).toHaveLength(2)
    expect(events).toContain(EServeEvent.RolloverDispatched)
  })

  it('a retire for any other reason never calls the API', async () => {
    const test = setup()
    let calls = 0
    test.rollover.start(async () => {
      calls += 1
      return { dispatched: true }
    })
    await test.rollover.beforeRetire({ reason: 'serve-swap' })
    expect(calls).toBe(0)
  })

  it('a refused drain rearms idle and allows a later attempt', async () => {
    const test = setup(async () => {
      throw new Error('a child could not pause')
    })
    test.rollover.start(async () => ({ dispatched: true }))
    await Bun.sleep(0)
    expect(test.rearms).toHaveLength(1)
    test.rollover.start(async () => ({ dispatched: true }))
    expect(test.drains).toHaveLength(2)
  })
})
