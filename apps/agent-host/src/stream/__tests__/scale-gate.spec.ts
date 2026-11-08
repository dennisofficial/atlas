import { afterAll, describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ESessionConnection,
  memorySessionCache,
  type SessionCache,
} from '@dltech/atlas-client/stream'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import {
  percentile,
  realisticBody,
  spawnFollowers,
  startScaleRig,
  type FollowersReport,
  type ScaleRig,
} from './scale-rig'

const enabled = process.env.ATLAS_SCALE_TESTS === '1'
const TOTAL_EVENTS = 20_000
const WARM_BEHIND = 50
const OPEN_RUNS = 3
const OPEN_BUDGET_MS = 1_000
const FOLLOWERS = 1_000
const APPENDS = 3_000
const EVENTS_PER_APPEND = 2
const APPEND_INTERVAL_MS = 20
const P99_BUDGET_MS = 250
const SAMPLE_MS = 500

type OpenTimes = { cold: number[]; warm: number[] }
type FanOut = {
  report: FollowersReport
  appendP50: number
  appendP99: number
  cpuPercent: number
  peakRssMb: number
  wallSeconds: number
}

const opens: OpenTimes = { cold: [], warm: [] }
let fanOut: FanOut | undefined

const timeToHead = async (args: { rig: ScaleRig; cache: SessionCache }): Promise<number> => {
  const started = performance.now()
  const target = args.rig.head().seq
  const session = args.rig.connect().follow({ sessionId: args.rig.sessionId, cache: args.cache })
  await new Promise<void>((resolve) => {
    const check = (): boolean => {
      const snapshot = session.getSnapshot()
      return snapshot.connection === ESessionConnection.Live && snapshot.cursor?.seq === target
    }
    if (check()) return resolve()
    const off = session.subscribe(() => {
      if (!check()) return
      off()
      resolve()
    })
  })
  return performance.now() - started
}

const savedCache = async (args: { rig: ScaleRig; from: SessionCache }): Promise<SessionCache> => {
  const deadline = Date.now() + 5_000
  for (;;) {
    const window = await args.from.load(args.rig.sessionId)
    if (window?.cursor?.seq === args.rig.head().seq) {
      const copy = memorySessionCache()
      await copy.save({ sessionId: args.rig.sessionId, window })
      return copy
    }
    if (Date.now() > deadline) throw new Error('the follower never saved its window')
    await Bun.sleep(25)
  }
}

const writeEvidence = async (): Promise<void> => {
  const dir = join(process.env.ATLAS_CONTEXT_DIR ?? '/tmp', 'evidence')
  await mkdir(dir, { recursive: true })
  const ms = (values: number[]): string => values.map((value) => value.toFixed(0)).join(', ')
  const opening = `Open, ${TOTAL_EVENTS} seeded events: cold ${ms(opens.cold)} ms, warm (${WARM_BEHIND} behind) ${ms(opens.warm)} ms.`
  if (fanOut === undefined) {
    await writeFile(join(dir, 'stream-scale-gate.md'), `# Stream scale gate\n\n${opening}\n`)
    return
  }
  const { report } = fanOut
  await writeFile(
    join(dir, 'stream-scale-gate.md'),
    [
      '# Stream scale gate',
      '',
      opening,
      '',
      `Fan-out: ${FOLLOWERS} sockets, ${APPENDS} events in ${APPENDS / EVENTS_PER_APPEND} appends of ${EVENTS_PER_APPEND}, achieved ${(APPENDS / fanOut.wallSeconds).toFixed(0)} events/s and ${(APPENDS / EVENTS_PER_APPEND / fanOut.wallSeconds).toFixed(0)} appends/s over ${fanOut.wallSeconds.toFixed(1)} s.`,
      '',
      '| measure | value |',
      '| --- | --- |',
      `| socket latency p50 (ms) | ${report.p50.toFixed(1)} |`,
      `| socket latency p99 (ms) | ${report.p99.toFixed(1)} |`,
      `| socket latency max (ms) | ${report.max.toFixed(1)} |`,
      `| append p50 (ms) | ${fanOut.appendP50.toFixed(1)} |`,
      `| append p99 (ms) | ${fanOut.appendP99.toFixed(1)} |`,
      `| server CPU (% of one core) | ${fanOut.cpuPercent.toFixed(0)} |`,
      `| server peak RSS (MB) | ${fanOut.peakRssMb.toFixed(0)} |`,
      `| received / expected | ${report.received} / ${report.expected} |`,
      `| gaps / duplicates / closed sockets | ${report.gaps} / ${report.duplicates} / ${report.closed} |`,
      '',
    ].join('\n'),
  )
}

describe.skipIf(!enabled)('stream scale gate (ATLAS_SCALE_TESTS=1)', () => {
  const testDb = useTestDatabase()

  afterAll(writeEvidence)

  it('opens a 20k-event thread inside a second, cold and warm', async () => {
    const rig = await startScaleRig({
      database: testDb(),
      sessionId: 'scale-open',
      maxConnectionsPerUser: 20,
    })
    try {
      await rig.seed(TOTAL_EVENTS)
      for (let run = 0; run < OPEN_RUNS; run += 1) {
        const cache = memorySessionCache()
        opens.cold.push(await timeToHead({ rig, cache }))
        const behind = await savedCache({ rig, from: cache })
        await rig.append(Array.from({ length: WARM_BEHIND }, (_, i) => realisticBody(i)))
        opens.warm.push(await timeToHead({ rig, cache: behind }))
      }
    } finally {
      await rig.stop()
    }
    expect(Math.max(...opens.cold)).toBeLessThanOrEqual(OPEN_BUDGET_MS)
    expect(Math.max(...opens.warm)).toBeLessThanOrEqual(OPEN_BUDGET_MS)
  }, 900_000)

  it('fans 100 events a second out to 1,000 followers with p99 under 250 ms', async () => {
    const rig = await startScaleRig({
      database: testDb(),
      sessionId: 'scale-fanout',
      maxConnectionsPerUser: FOLLOWERS,
    })
    await rig.append([{ type: 'user-said', text: 'seed' }])
    const followers = spawnFollowers({
      port: rig.port,
      sessionId: rig.sessionId,
      followers: FOLLOWERS,
      appends: APPENDS,
    })
    try {
      await followers.ready
      const appendMs: number[] = []
      let peakRss = 0
      const sampler = setInterval(() => {
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
      }, SAMPLE_MS)
      const cpuBefore = process.cpuUsage()
      const started = performance.now()
      for (let i = 0; i < APPENDS / EVENTS_PER_APPEND; i += 1) {
        const due = started + i * APPEND_INTERVAL_MS
        const wait = due - performance.now()
        if (wait > 0) await Bun.sleep(wait)
        const sentAt = performance.timeOrigin + performance.now()
        await rig.append(
          Array.from({ length: EVENTS_PER_APPEND }, () => ({
            type: 'user-said' as const,
            text: String(sentAt),
          })),
        )
        appendMs.push(performance.timeOrigin + performance.now() - sentAt)
      }
      const wallMs = performance.now() - started
      const cpu = process.cpuUsage(cpuBefore)
      await Bun.sleep(1_000)
      clearInterval(sampler)
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
      const report = await followers.finish()
      fanOut = {
        report,
        appendP50: percentile(appendMs, 0.5),
        appendP99: percentile(appendMs, 0.99),
        cpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100,
        peakRssMb: peakRss / 1_048_576,
        wallSeconds: wallMs / 1000,
      }
    } finally {
      followers.kill()
      await rig.stop()
    }
    expect(fanOut?.report.gaps).toBe(0)
    expect(fanOut?.report.duplicates).toBe(0)
    expect(fanOut?.report.received).toBe(FOLLOWERS * APPENDS)
    expect(fanOut?.report.p99).toBeLessThanOrEqual(P99_BUDGET_MS)
  }, 900_000)
})
