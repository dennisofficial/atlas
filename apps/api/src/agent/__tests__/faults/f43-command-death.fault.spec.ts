import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import { EHostFault } from '../../testing/host-faults'
import { sleep, waitForLog, waitUntil } from './lease-fault-support'
import { echoScript, postMessage, REDIS_URL, waitAnswers } from './settle-fault-support'

describe.skipIf(REDIS_URL === undefined)('F43 SIGKILL after a command is consumed', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  const rawEvents = async (threadId: string) =>
    (await rig.plane.readEvents({ threadId, afterSeq: 0, limit: 1_000, visible: false })).events

  const rewoundCount = async (threadId: string): Promise<number> =>
    (await rawEvents(threadId)).filter((event) => event.type === 'history-rewound').length

  it('the next holder runs the consumed rewind exactly once', async () => {
    const sessionId = 'fault-f43-1'
    const threadId = await rig.newSession({ sessionId, text: 'first' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      knobs: { fault: EHostFault.CommandOutcomeHangs },
      scripts: { [sessionId]: echoScript({ replies: 3 }) },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
    await waitAnswers({ rig, threadId, count: 1, host: hostA, timeoutMs: 30_000 })
    await postMessage({ rig, sessionId, text: 'second' })
    await waitAnswers({ rig, threadId, count: 2, host: hostA, timeoutMs: 30_000 })

    const first = (await rawEvents(threadId)).find((event) => event.type === 'user-said')
    if (first === undefined) throw new Error('no user message to rewind to')
    const posted = await rig.plane.post({
      sessionId,
      kind: 'command:rewind',
      payload: JSON.stringify({ toSeq: first.seq }),
    })
    await rig.wake(sessionId)
    await waitForLog({ host: hostA, text: 'fault: command outcome hangs', timeoutMs: 30_000 })
    expect(await rewoundCount(threadId)).toBe(0)

    hostA.kill('SIGKILL')
    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: echoScript({ replies: 3 }) },
    })
    await rig.claim({ sessionId, label: 'host-b', timeoutMs: 60_000 })
    await waitUntil({
      what: `one history-rewound for inbox ${posted.inboxId}\n${hostB.logs().join('\n')}`,
      timeoutMs: 30_000,
      check: async () =>
        (await rawEvents(threadId)).some(
          (event) => event.type === 'history-rewound' && event.inboxId === posted.inboxId,
        ),
    })
    await sleep(2_000)
    expect(await rewoundCount(threadId)).toBe(1)
  }, 180_000)
})
