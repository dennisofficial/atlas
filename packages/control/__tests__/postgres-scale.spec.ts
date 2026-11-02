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
const SAMPLES = 15

const p50 = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number

const withinBound = (params: { late: number; early: number }): boolean =>
  params.late <= params.early * 2 || params.late - params.early <= 5

describe.skipIf(!enabled)('postgres scale (ATLAS_SCALE_TESTS=1)', () => {
  const testDb = useTestDatabase()

  it('keeps append and ranged reads flat to 20k events', async () => {
    const { db, pool } = testDb()
    const plane = new ControlPlane({
      store: new PostgresControlStore(db),
      clock: () => new Date().toISOString(),
    })
    await plane.createSession({ sessionId: SESSION })
    await plane.createThread({ threadId: THREAD, sessionId: SESSION })
    const { epoch } = await plane.grant({ sessionId: SESSION, holderId: 'pod', ttlMs: 3_600_000 })

    const timedAppend = async (): Promise<number> => {
      const head = await plane.head({ threadId: THREAD })
      const events = mint({
        bodies: Array.from({ length: BATCH }, (_, i) =>
          said(`message ${head.seq + i} lorem ipsum`),
        ),
        epoch,
        from: head,
      })
      const start = performance.now()
      const outcome = await plane.append({ threadId: THREAD, epoch, events })
      const elapsed = performance.now() - start
      if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
      return elapsed
    }
    const sample = async (): Promise<number> => {
      const times: number[] = []
      for (let i = 0; i < SAMPLES; i += 1) times.push(await timedAppend())
      return p50(times)
    }
    const timedRead = async (afterSeq: number): Promise<number> => {
      const start = performance.now()
      const page = await plane.readEvents({ threadId: THREAD, afterSeq, limit: 500, visible: true })
      expect(page.events.length).toBe(500)
      return performance.now() - start
    }
    const readP50 = async (afterSeq: number): Promise<number> => {
      const times: number[] = []
      for (let i = 0; i < SAMPLES; i += 1) times.push(await timedRead(afterSeq))
      return p50(times)
    }

    while ((await plane.head({ threadId: THREAD })).seq < 1000 - SAMPLES * BATCH)
      await timedAppend()
    const appendEarly = await sample()
    const seedStart = performance.now()
    while ((await plane.head({ threadId: THREAD })).seq < TOTAL - SAMPLES * BATCH)
      await timedAppend()
    const seedSeconds = (performance.now() - seedStart) / 1000
    const appendLate = await sample()
    const head = await plane.head({ threadId: THREAD })

    const readStart = await readP50(0)
    const readTail = await readP50(head.seq - 500)

    const plan = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT * FROM "v2"."V2Event" WHERE "threadId" = $1 AND "seq" > $2 AND "seq" <= $3 ORDER BY "seq" LIMIT 500`,
      [THREAD, head.seq - 500, head.seq],
    )
    const planText = plan.rows.map((row) => row['QUERY PLAN']).join('\n')

    const evidence = join(process.env.ATLAS_CONTEXT_DIR ?? '/tmp', 'evidence')
    await mkdir(evidence, { recursive: true })
    await writeFile(
      join(evidence, 'scale-test.md'),
      [
        '# Scale test (exit test 8), Postgres',
        '',
        `Events: ${head.seq}, batch ${BATCH}, ${SAMPLES} samples per point.`,
        `Seeding 1k -> ${TOTAL} through ControlPlane.append: ${seedSeconds.toFixed(1)} s.`,
        '',
        `| measure | near 1k | near ${TOTAL} |`,
        `| --- | --- | --- |`,
        `| 50-event append p50 (ms) | ${appendEarly.toFixed(2)} | ${appendLate.toFixed(2)} |`,
        `| 500-event ranged read p50 (ms) | ${readStart.toFixed(2)} (start) | ${readTail.toFixed(2)} (tail) |`,
        '',
        'Bound: late <= 2x early, or absolute difference <= 5 ms.',
        '',
        'EXPLAIN of the ranged read:',
        '```',
        planText,
        '```',
        '',
      ].join('\n'),
    )

    expect(withinBound({ late: appendLate, early: appendEarly })).toBe(true)
    expect(withinBound({ late: readTail, early: readStart })).toBe(true)
    expect(planText).not.toContain('Seq Scan')
    expect(planText).toMatch(/Index/)
  }, 900_000)
})
