import { describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionViewState, V2Event } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { decodeViewState, encodeViewState } from '../src/session-view-codec'
import { foldEvents } from '../src/session-view-ops'
import { mint, said, SESSION, THREAD } from '../src/testing/conformance/support'

const enabled = process.env.ATLAS_SCALE_TESTS === '1'
const TOTAL = 20_000
const BATCH = 50
const SAMPLES = 100
const COLD_CATCH_UP_MS = 1500
const VIEW_SAMPLES = 200
const VIEW_WARMUP = 20
const VIEW_P99_MS = 2

const percentile = (values: number[], fraction: number): number =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ] as number

const viewCost = (state: SessionViewState, events: readonly V2Event[]): number => {
  const start = performance.now()
  const folded = foldEvents({ state, events })
  encodeViewState(folded.state)
  return performance.now() - start
}

const fmt = (values: number[]): string =>
  `${percentile(values, 0.5).toFixed(3)} / ${percentile(values, 0.99).toFixed(3)}`

describe.skipIf(!enabled)('postgres session view scale (ATLAS_SCALE_TESTS=1)', () => {
  const testDb = useTestDatabase()

  it('keeps append flat and catches a cold view up inside a second at 20k events', async () => {
    const { db } = testDb()
    const store = new PostgresControlStore(db)
    const plane = new ControlPlane({ store, clock: () => new Date().toISOString() })
    await plane.createSession({
      sessionId: SESSION,
      userId: 'user-1',
      projectId: 'project-1',
      mainThreadId: THREAD,
    })
    const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })

    const timedAppend = async (): Promise<number> => {
      const head = await plane.head({ threadId: THREAD })
      const events = mint({
        bodies: Array.from({ length: BATCH }, (_, i) => said(`message ${head.seq + i} lorem`)),
        epoch,
        from: head,
      })
      const start = performance.now()
      const outcome = await plane.append({ threadId: THREAD, epoch, events })
      const elapsed = performance.now() - start
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      return elapsed
    }
    const sample = async (): Promise<number[]> => {
      const times: number[] = []
      for (let i = 0; i < SAMPLES; i += 1) times.push(await timedAppend())
      return times
    }

    const measureView = async (): Promise<{
      at: number
      bytes: number
      costs: number[]
      writeMs: number
    }> => {
      const row = await store.transact((tx) => tx.readSessionView(SESSION))
      const state = decodeViewState(row?.state ?? '')
      if (row === undefined || state === undefined) throw new Error('no usable session view row')
      const head = await plane.head({ threadId: THREAD })
      const batches = Array.from({ length: VIEW_WARMUP + VIEW_SAMPLES }, (_, n) =>
        mint({
          bodies: Array.from({ length: BATCH }, (_, i) => said(`message ${n * BATCH + i} lorem`)),
          epoch,
          from: head,
        }),
      )
      const costs = batches.map((events) => viewCost(state, events)).slice(VIEW_WARMUP)
      const write = async (): Promise<number> => {
        const start = performance.now()
        await store.transact((tx) => tx.writeSessionView(row))
        return performance.now() - start
      }
      await write()
      return { at: state.at, bytes: Buffer.byteLength(row.state), costs, writeMs: await write() }
    }

    for (let i = 0; i < 20; i += 1) await timedAppend()
    const viewEarly = await measureView()
    const early = await sample()
    while ((await plane.head({ threadId: THREAD })).seq < TOTAL - SAMPLES * BATCH) {
      await timedAppend()
    }
    const late = await sample()
    const viewLate = await measureView()

    await store.transact((tx) =>
      tx.writeSessionView({
        sessionId: SESSION,
        threadId: THREAD,
        atSeq: 0,
        version: 0,
        state: '{}',
      }),
    )
    const coldStart = performance.now()
    const cold = await plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
    const coldMs = performance.now() - coldStart
    const warmStart = performance.now()
    await plane.readSessionView({ sessionId: SESSION, threadId: THREAD })
    const warmMs = performance.now() - warmStart

    const evidence = join(process.env.ATLAS_CONTEXT_DIR ?? '/tmp', 'evidence')
    await mkdir(evidence, { recursive: true })
    await writeFile(
      join(evidence, 'view-scale-test.md'),
      [
        `# Session view scale, Postgres, ${cold.at} events`,
        '',
        `| measure | near 1k | near ${TOTAL} |`,
        '| --- | --- | --- |',
        `| ${BATCH}-event append p50 (ms) | ${percentile(early, 0.5).toFixed(2)} | ${percentile(late, 0.5).toFixed(2)} |`,
        `| ${BATCH}-event append p99 (ms) | ${percentile(early, 0.99).toFixed(2)} | ${percentile(late, 0.99).toFixed(2)} |`,
        '',
        `| view work alone | at ${viewEarly.at} events | at ${viewLate.at} events |`,
        '| --- | --- | --- |',
        `| view fold+encode ${BATCH} events p50/p99 (ms) | ${fmt(viewEarly.costs)} | ${fmt(viewLate.costs)} |`,
        `| encoded view state bytes | ${viewEarly.bytes} | ${viewLate.bytes} |`,
        `| view row write (ms) | ${viewEarly.writeMs.toFixed(2)} | ${viewLate.writeMs.toFixed(2)} |`,
        '',
        `Cold catch-up from no row: ${coldMs.toFixed(0)} ms. Warm read: ${warmMs.toFixed(1)} ms.`,
        '',
      ].join('\n'),
    )

    expect(cold.at).toBe(TOTAL)
    expect(coldMs).toBeLessThanOrEqual(COLD_CATCH_UP_MS)
    expect(percentile(late, 0.99) - percentile(early, 0.99)).toBeLessThanOrEqual(5)
    expect(percentile(viewLate.costs, 0.99)).toBeLessThanOrEqual(VIEW_P99_MS)
  }, 900_000)
})
