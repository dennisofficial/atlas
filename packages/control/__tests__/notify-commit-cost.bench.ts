import { describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { LogHead } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import {
  ControlStorePort,
  type ControlTx,
  type ListDueRoutinesParams,
  type RoutineRow,
} from '../src/port'
import { mint, said } from '../src/testing/conformance/support'

const enabled = process.env.ATLAS_BENCH === '1'
const SESSIONS = 20
const RATE_PER_SECOND = 100
const SECONDS = 10

class SilentStore extends ControlStorePort {
  constructor(private readonly inner: ControlStorePort) {
    super()
  }

  transact<T>(work: (tx: ControlTx) => Promise<T>): Promise<T> {
    return this.inner.transact((tx) =>
      work(Object.assign(Object.create(tx) as ControlTx, { announce: async () => undefined })),
    )
  }

  listDueRoutines(params: ListDueRoutinesParams): Promise<RoutineRow[]> {
    return this.inner.listDueRoutines(params)
  }
}

const percentile = (params: { values: number[]; fraction: number }): number => {
  const sorted = [...params.values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * params.fraction))] as number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe.skipIf(!enabled)('notify commit cost (ATLAS_BENCH=1)', () => {
  const testDb = useTestDatabase()

  const measure = async (params: { announce: boolean; label: string }): Promise<number[]> => {
    const real = new PostgresControlStore(testDb().db)
    const plane = new ControlPlane({
      store: params.announce ? real : new SilentStore(real),
      clock: () => new Date().toISOString(),
    })
    const heads = new Map<string, LogHead>()
    const epochs = new Map<string, number>()
    for (let index = 0; index < SESSIONS; index += 1) {
      const sessionId = `${params.label}-s${index}`
      await plane.createSession({
        sessionId,
        userId: 'user-1',
        projectId: 'project-1',
        mainThreadId: `${sessionId}-t`,
      })
      const lease = await plane.grant({ sessionId, hostId: 1 })
      epochs.set(sessionId, lease.epoch)
      heads.set(sessionId, await plane.head({ threadId: `${sessionId}-t` }))
    }
    const latencies: number[] = []
    const sessionIds = [...heads.keys()]
    const total = RATE_PER_SECOND * SECONDS
    const started = performance.now()
    const inflight: Promise<void>[] = []
    for (let n = 0; n < total; n += 1) {
      const wait = started + (n * 1000) / RATE_PER_SECOND - performance.now()
      if (wait > 0) await sleep(wait)
      const sessionId = sessionIds[n % SESSIONS] as string
      const previous = inflight[n - SESSIONS] ?? Promise.resolve()
      inflight.push(
        previous.then(async () => {
          const epoch = epochs.get(sessionId) as number
          const from = heads.get(sessionId) as LogHead
          const events = mint({
            bodies: [said(`m${n}`)],
            epoch,
            from,
            threadId: `${sessionId}-t`,
          })
          const begin = performance.now()
          const outcome = await plane.append({ threadId: `${sessionId}-t`, epoch, events })
          latencies.push(performance.now() - begin)
          if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
          heads.set(sessionId, outcome.head)
        }),
      )
    }
    await Promise.all(inflight)
    return latencies
  }

  it('records commit latency with and without announce', async () => {
    const silent = await measure({ announce: false, label: 'silent' })
    const announced = await measure({ announce: true, label: 'announced' })
    const row = (values: number[]): string =>
      `${percentile({ values, fraction: 0.5 }).toFixed(2)} | ${percentile({ values, fraction: 0.99 }).toFixed(2)}`
    const table = [
      '| variant | appends | p50 (ms) | p99 (ms) |',
      '| --- | --- | --- | --- |',
      `| without announce | ${silent.length} | ${row(silent)} |`,
      `| with announce | ${announced.length} | ${row(announced)} |`,
    ].join('\n')
    const evidence = join(process.env.ATLAS_CONTEXT_DIR ?? '/tmp', 'evidence')
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, 'notify-commit-cost.md'), `${table}\n`)
    console.log(table)
    expect(announced.length).toBe(RATE_PER_SECOND * SECONDS)
  }, 120_000)
})
