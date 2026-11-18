import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { GENESIS_HASH, verifySuffix, type V2Event } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  expectOneResultPerDispatch,
  isDoneResult,
  makeFifo,
  releaseFifo,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(REDIS_URL === undefined)('F19 both agent hosts restarted at once', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the session resumes on a fresh host with the record intact', async () => {
    const sessionId = `fault-f19-1-${RUN}`
    const threadId = await rig.newSession({ sessionId, text: 'two commands' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const startedFile = join(daemon.home, `started-${sessionId}`)
    const gateFifo = join(daemon.home, `gate-${sessionId}`)
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    makeFifo({ path: gateFifo })
    const quick = `echo one >> ${runsFile}; echo done`
    const gated = `touch ${startedFile}; echo two >> ${runsFile}; cat ${gateFifo}; echo done`

    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      scripts: {
        [sessionId]: [
          {
            calls: [
              { callId: 'c1', name: 'bash', input: { description: 'quick', command: quick } },
            ],
          },
          {
            calls: [
              { callId: 'c2', name: 'bash', input: { description: 'sleep', command: gated } },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitForFile({ path: startedFile, timeoutMs: 30_000 })
    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })

    const beforeKill = await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c2'),
      timeoutMs: 20_000,
    })
    expect(beforeKill.some((row) => callIdOf(row) === 'c1' && isDoneResult(row))).toBe(true)

    const preKill = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(preKill.lease.holderHostId)).toBe('host-a')

    hostA.kill('SIGKILL')
    hostB.kill('SIGKILL')
    await Promise.all([hostA.exited, hostB.exited])

    const hostC = await rig.spawnHost({
      label: 'host-c',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host c resumed' }] },
    })
    const hostD = await rig.spawnHost({
      label: 'host-d',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host d resumed' }] },
    })

    const claimed = await (async (): Promise<string> => {
      const deadline = Date.now() + 30_000
      for (;;) {
        await rig.wake(sessionId).catch(() => undefined)
        const lease = await rig.plane.currentLease({ sessionId })
        const label = lease.live ? await rig.labelOf(lease.lease.holderHostId) : undefined
        if (label === 'host-c' || label === 'host-d') return label
        if (Date.now() > deadline) throw new Error('no fresh host claimed the session')
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    })()

    await releaseFifo({ path: gateFifo })

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => callIdOf(row) === 'c2' && isDoneResult(row)) &&
          rows.some(
            (row) => row.type === 'assistant-said' && JSON.stringify(row.event).includes('resumed'),
          ),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostC logs:\n${hostC.logs().join('\n')}\nhostD logs:\n${hostD.logs().join('\n')}`,
        )
      })

    expect(
      events.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
    ).toHaveLength(1)
    expect(
      events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1'),
    ).toHaveLength(1)
    expect(
      events.filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c2'),
    ).toHaveLength(1)
    expect(
      events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c2'),
    ).toHaveLength(1)
    expect(events.filter((row) => callIdOf(row) === 'c2' && isDoneResult(row))).toHaveLength(1)

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['one', 'two'])

    const seqs = events.map((row) => row.seq)
    expect(seqs).toEqual([...seqs].sort((left, right) => left - right))
    expect(new Set(seqs).size).toBe(seqs.length)

    const chain = verifySuffix({
      trusted: { seq: 0, hash: GENESIS_HASH },
      events: events.map((row) => row.event as V2Event),
    })
    expect(chain).toMatchObject({ ok: true })

    expectOneResultPerDispatch(events)

    const lease = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(lease.lease.holderHostId)).toBe(claimed)
    expect(lease.lease.epoch).toBeGreaterThan(preKill.lease.epoch)
    expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })
  }, 90_000)
})
