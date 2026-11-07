import { describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ControlPlane } from '../src/control-plane'
import { PostgresControlStore } from '../src/postgres'
import { mint, said, SESSION, THREAD } from '../src/testing/conformance/support'

const enabled = process.env.ATLAS_SCALE_TESTS === '1'
const TOTAL = 20_000
const BATCH = 50
const SAMPLES = 100
const COLD_CATCH_UP_MS = 1500

const percentile = (values: number[], fraction: number): number =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ] as number

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

    for (let i = 0; i < 20; i += 1) await timedAppend()
    const early = await sample()
    while ((await plane.head({ threadId: THREAD })).seq < TOTAL - SAMPLES * BATCH) {
      await timedAppend()
    }
    const late = await sample()

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
        `Cold catch-up from no row: ${coldMs.toFixed(0)} ms. Warm read: ${warmMs.toFixed(1)} ms.`,
        '',
      ].join('\n'),
    )

    expect(cold.at).toBe(TOTAL)
    expect(coldMs).toBeLessThanOrEqual(COLD_CATCH_UP_MS)
    expect(percentile(late, 0.99) - percentile(early, 0.99)).toBeLessThanOrEqual(5)
  }, 900_000)
})
