import { describe, expect, it } from 'bun:test'
import { LogPort, type LogEntry } from '@dltech/atlas-observability'

import { FakeClock, flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

class CollectingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

describe('SessionHolder take-over', () => {
  it('loads the record while the runtime config is still resolving', async () => {
    const gate = Promise.withResolvers<void>()
    const rig = await makeRig({ runtimeGate: gate.promise })
    await seedSession(rig)
    let recordLoads = 0
    const readEvents = rig.plane.readEvents.bind(rig.plane)
    rig.plane.readEvents = (params) => {
      recordLoads += 1
      return readEvents(params)
    }
    await rig.holder.start()
    await rig.wake()
    const overlapped = await flushUntil({ check: () => recordLoads > 0 })
    expect(overlapped).toBe(true)
    expect(rig.runtimes).toHaveLength(0)
    gate.resolve()
    await rig.post('go')
    await rig.wake()
    const done = await flushUntil({
      check: async () => (await rig.events()).some((event) => event.type === 'assistant-said'),
    })
    expect(done).toBe(true)
  })

  it('takes over in about the slower of config and record, not their sum', async () => {
    const runtimeDelay = 400
    const recordDelay = 300
    const log = new CollectingLog()
    const clock = new FakeClock()
    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        clock.setTimeout(resolve, ms)
      })
    const rig = await makeRig({
      log,
      clock,
      beforeRuntime: () => sleep(runtimeDelay),
    })
    await seedSession(rig)
    const readEvents = rig.plane.readEvents.bind(rig.plane)
    rig.plane.readEvents = async (params) => {
      await sleep(recordDelay)
      return readEvents(params)
    }
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    const logged = (): boolean => log.entries.some((entry) => entry.source === 'holder.takeover')
    for (let step = 0; step < 20 && !logged(); step += 1) {
      await rig.flush()
      clock.advance(50)
    }
    await flushUntil({ check: logged })
    const line = log.entries.find((entry) => entry.source === 'holder.takeover')
    expect(line?.data).toMatchObject({
      source: 'holder.takeover',
      sessionId: SESSION,
      claimMs: 0,
      configMs: runtimeDelay,
      recordMs: recordDelay,
    })
    const firstStepMs = Number((line?.data as { firstStepMs?: number } | undefined)?.firstStepMs)
    expect(firstStepMs).toBeGreaterThanOrEqual(runtimeDelay)
    expect(firstStepMs).toBeLessThan(runtimeDelay + recordDelay)
  })
})
