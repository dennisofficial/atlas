import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'
import { GENESIS_HASH, verifySuffix, type V2Event } from '@dltech/atlas-core'

import { startRig, type FaultRig } from '../../testing/fault-rig'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

describe.skipIf(REDIS_URL === undefined)('scripted session across processes', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('runs the 5-tool scripted session in a host process through both proxies', async () => {
    const sessionId = 'fault-scripted-1'
    const threadId = await rig.newSession({ sessionId, text: 'run the tools' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const host = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      scripts: {
        [sessionId]: [
          {
            calls: [
              { callId: 'c1', name: 'bash', input: { description: 'echo', command: 'echo hi' } },
            ],
          },
          {
            calls: [
              {
                callId: 'c2',
                name: 'write',
                input: { path: 'hello.txt', content: 'hello world\n' },
              },
            ],
          },
          { calls: [{ callId: 'c3', name: 'read', input: { path: 'hello.txt' } }] },
          {
            calls: [
              {
                callId: 'c4',
                name: 'edit',
                input: { path: 'hello.txt', oldString: 'world', newString: 'atlas' },
              },
            ],
          },
          { calls: [{ callId: 'c5', name: 'grep', input: { pattern: 'atlas' } }] },
          { text: 'done' },
        ],
      },
    })

    await rig.claim({ sessionId, label: 'host-a' })
    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.filter((row) => row.type === 'tool-result').length >= 5 &&
          rows.some((row) => row.type === 'assistant-said'),
        timeoutMs: 45_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhost logs:\n${host.logs().join('\n')}`,
        )
      })

    const results = events.filter((row) => row.type === 'tool-result')
    expect(results.length).toBe(5)
    for (const result of results) {
      const body = result.event as { error?: unknown; interrupted?: unknown; output?: unknown }
      expect(body.error).toBeUndefined()
      expect(body.interrupted).not.toBe(true)
      expect(body.output).toBeDefined()
    }
    expect(results.map((row) => (row.event as { name?: string }).name)).toEqual([
      'bash',
      'write',
      'read',
      'edit',
      'grep',
    ])
    const chain = verifySuffix({
      trusted: { seq: 0, hash: GENESIS_HASH },
      events: events.map((row) => row.event as V2Event),
    })
    expect(chain).toMatchObject({ ok: true })
  }, 60_000)
})
