import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { MAX_START_ATTEMPTS } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { waitUntil } from './lease-fault-support'
import { echoScript, postMessage, REDIS_URL, waitAnswers } from './settle-fault-support'

const countOf = (rows: readonly { type: string }[], type: string): number =>
  rows.filter((row) => row.type === type).length

describe.skipIf(REDIS_URL === undefined)('F37 a session that crashes its holder every time', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('records one session-start-failed, resets the lease and serves later messages', async () => {
    const poison = 'fault-f37-poison'
    const healthy = 'fault-f37-healthy'
    const poisonThread = await rig.newSession({ sessionId: poison, text: 'poison' })
    const poisonDaemon = await rig.spawnDaemonFor({ sessionId: poison })
    const healthyDaemon = await rig.spawnDaemonFor({ sessionId: healthy })
    const daemonUrls = { [poison]: poisonDaemon.url, [healthy]: healthyDaemon.url }
    const knobs = { sweepMs: 1_000 }
    const hangs = { [poison]: [{ gateFile: '/nonexistent/never-opens', text: 'never' }] }

    for (let round = 1; round <= MAX_START_ATTEMPTS; round += 1) {
      const host = await rig.spawnHost({
        label: `host-f37-${round}`,
        daemonUrl: poisonDaemon.url,
        daemonUrls,
        knobs,
        scripts: hangs,
      })
      await rig.waitHeldBy({ sessionId: poison, label: host.label, timeoutMs: 45_000 })
      host.kill('SIGKILL')
      await host.exited
    }
    expect((await rig.plane.currentLease({ sessionId: poison })).lease.attempts).toBe(
      MAX_START_ATTEMPTS,
    )

    const final = await rig.spawnHost({
      label: 'host-f37-final',
      daemonUrl: poisonDaemon.url,
      daemonUrls,
      knobs,
      scripts: { [poison]: echoScript({ replies: 1 }), [healthy]: echoScript({ replies: 2 }) },
    })
    await rig.waitForSeq({
      threadId: poisonThread,
      want: (rows) => countOf(rows, 'session-start-failed') === 1,
      timeoutMs: 45_000,
    })
    await waitUntil({
      what: 'the quarantined lease to be reset',
      timeoutMs: 10_000,
      check: async () => {
        const { lease } = await rig.plane.currentLease({ sessionId: poison })
        return (
          lease.holderHostId === null &&
          !lease.wantsHolder &&
          lease.attempts === 0 &&
          lease.retryAfter === null
        )
      },
    })

    const healthyThread = await rig.newSession({ sessionId: healthy, text: 'hello' })
    await waitAnswers({ rig, threadId: healthyThread, count: 1, host: final, timeoutMs: 30_000 })

    await postMessage({ rig, sessionId: poison, text: 'retry' })
    const events = await waitAnswers({
      rig,
      threadId: poisonThread,
      count: 1,
      host: final,
      timeoutMs: 30_000,
    })
    expect(countOf(events, 'session-start-failed')).toBe(1)
  }, 240_000)
})
