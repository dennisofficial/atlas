import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import pg from 'pg'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { PG_PRESENCE_LOCK_NAMESPACE } from '@dltech/atlas-protocol'

import { PRESENCE_APPLICATION_NAME } from '../../presence/pg-host-presence'
import { startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, releaseFifo, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

const terminatePresence = async (args: { url: string; hostId: number }): Promise<number> => {
  const killer = new pg.Client(args.url)
  await killer.connect()
  try {
    const result = await killer.query(
      `SELECT pg_terminate_backend(l.pid) FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND l.classid = $1 AND l.objid = $2
         AND a.application_name = $3`,
      [PG_PRESENCE_LOCK_NAMESPACE, args.hostId, PRESENCE_APPLICATION_NAME],
    )
    return result.rowCount ?? 0
  } finally {
    await killer.end()
  }
}

describe.skipIf(REDIS_URL === undefined)('F22 presence connection killed mid-turn', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the same host re-registers, re-claims at the next epoch and finishes the turn once', async () => {
    const sessionId = `fault-f22-1-${RUN}`
    const threadId = await rig.newSession({ sessionId, text: 'one gated command' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const startedFile = join(daemon.home, `started-${sessionId}`)
    const gateFifo = join(daemon.home, `gate-${sessionId}`)
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    makeFifo({ path: gateFifo })
    const gated = `touch ${startedFile}; echo one >> ${runsFile}; cat ${gateFifo}; echo done`

    const host = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      scripts: {
        [sessionId]: [
          {
            calls: [
              { callId: 'c1', name: 'bash', input: { description: 'gated', command: gated } },
            ],
          },
          { text: 'finished after presence loss' },
        ],
        [`${sessionId}@2`]: [{ text: 'finished after presence loss' }],
      },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitForFile({ path: startedFile, timeoutMs: 30_000 })
    const before = await rig.plane.currentLease({ sessionId })

    const oldHostId = before.lease.holderHostId
    if (oldHostId === null) throw new Error('the session has no holder before the kill')
    const killed = await terminatePresence({
      url: testDb().url,
      hostId: oldHostId,
    })
    expect(killed).toBe(1)

    const after = await (async () => {
      const deadline = Date.now() + 30_000
      for (;;) {
        await rig.wake(sessionId).catch(() => undefined)
        const lease = await rig.plane.currentLease({ sessionId })
        if (lease.live && lease.lease.holderHostId !== before.lease.holderHostId) return lease
        if (Date.now() > deadline) {
          throw new Error(`host never re-claimed:\n${host.logs().join('\n')}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    })()
    expect(await rig.labelOf(after.lease.holderHostId)).toBe('host-a')
    expect(after.lease.holderHostId).not.toBe(before.lease.holderHostId)
    expect(after.lease.epoch).toBe(before.lease.epoch + 1)

    await releaseFifo({ path: gateFifo })

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
          rows.some(
            (row) =>
              row.type === 'assistant-said' && JSON.stringify(row.event).includes('finished'),
          ),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhost logs:\n${host.logs().join('\n')}`,
        )
      })

    expect(events.filter((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toHaveLength(1)
    expect(readFileSync(runsFile, 'utf8').trim().split('\n')).toEqual(['one'])
  }, 90_000)
})
