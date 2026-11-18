import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { EHostFault } from '../../testing/host-faults'
import {
  echoScript,
  IDLE_KNOBS,
  postMessage,
  REDIS_URL,
  waitAnswers,
  wakeCalls,
} from './settle-fault-support'

describe.skipIf(REDIS_URL === undefined)('F34 capacity freed by an idle release', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('claims the waiting session when the first idles out, with no post and no wake', async () => {
    const first = 'fault-f34-a'
    const second = 'fault-f34-b'
    const firstThread = await rig.newSession({ sessionId: first, text: 'one' })
    const secondThread = await rig.newSession({ sessionId: second, text: 'two' })
    const firstDaemon = await rig.spawnDaemonFor({ sessionId: first })
    const secondDaemon = await rig.spawnDaemonFor({ sessionId: second })
    const host = await rig.spawnHost({
      label: 'host-f34',
      daemonUrl: firstDaemon.url,
      daemonUrls: { [first]: firstDaemon.url, [second]: secondDaemon.url },
      knobs: { ...IDLE_KNOBS, maxSessions: 1, fault: EHostFault.SpyWake },
      scripts: {
        [first]: echoScript({ replies: 2 }),
        [second]: echoScript({ replies: 2 }),
      },
    })

    const answeredFirst = await waitAnswers({
      rig,
      threadId: firstThread,
      count: 1,
      host,
      timeoutMs: 30_000,
    })
    expect(answeredFirst.length).toBeGreaterThan(0)
    await waitAnswers({ rig, threadId: secondThread, count: 1, host, timeoutMs: 30_000 })
    expect(wakeCalls(host)).toBe(0)

    await postMessage({ rig, sessionId: first, text: 'again' })
    await waitAnswers({ rig, threadId: firstThread, count: 2, host, timeoutMs: 30_000 })
  }, 120_000)
})
