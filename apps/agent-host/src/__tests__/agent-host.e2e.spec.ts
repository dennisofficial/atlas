import { afterAll, beforeEach, describe, expect, it } from 'bun:test'

import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { createDb } from '@dltech/atlas-db'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'
import { GENESIS_HASH, verifySuffix, type V2Event } from '@dltech/atlas-core'

import { LocalSandboxProvider } from '../testing/local-sandbox-provider'
import {
  CollectingLog,
  E2E_SECRET,
  isDoneResult,
  makeHolder,
  makeInMemoryBus,
  readAllEvents,
  waitForLease,
  waitForSeq,
} from './e2e-support'

const testDb = useTestDatabase()
const bus = makeInMemoryBus()

const sleepCall = {
  calls: [
    {
      callId: 'c1',
      name: 'bash',
      input: { description: 'sleep', command: 'sleep 2 && echo done' },
    },
  ],
}

describe('agent-host e2e', () => {
  const sandbox = new LocalSandboxProvider({ daemonSecret: E2E_SECRET })
  let plane: ControlPlane

  beforeEach(async () => {
    bus.reset()
    plane = new ControlPlane({ store: new PostgresControlStore(createDb(testDb().pool)) })
  })

  afterAll(async () => {
    await sandbox.stopAll()
  })

  const newSession = async (args: { sessionId: string; text: string }): Promise<string> => {
    const mainThreadId = `thread-${args.sessionId}`
    await plane.createSession({
      sessionId: args.sessionId,
      userId: 'user-1',
      projectId: 'proj-1',
      mainThreadId,
    })
    await plane.post({
      sessionId: args.sessionId,
      kind: INBOX_KIND_MESSAGE,
      payload: JSON.stringify({ text: args.text }),
    })
    return mainThreadId
  }

  it('claims a woken session, runs the scripted tools, and records their results', async () => {
    const sessionId = 'e2e-session-1'
    const mainThreadId = await newSession({ sessionId, text: 'run the tools' })
    const holder = makeHolder({
      holderId: 'host-a',
      plane,
      bus,
      sandbox,
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
    await holder.start()

    await bus.wake(sessionId)
    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) =>
        rows.filter((row) => row.type === 'tool-result').length >= 5 &&
        rows.some((row) => row.type === 'assistant-said'),
    })

    const results = events.filter((row) => row.type === 'tool-result')
    expect(results.length).toBe(5)
    for (const result of results) {
      const body = result.event as { error?: unknown; interrupted?: boolean; output?: unknown }
      expect(body.error).toBeUndefined()
      expect(body.interrupted).not.toBe(true)
      expect(body.output).toBeDefined()
    }
    const names = results.map((row) => (row.event as { name?: string }).name)
    expect(names).toEqual(['bash', 'write', 'read', 'edit', 'grep'])
    const chain = verifySuffix({
      trusted: { seq: 0, hash: GENESIS_HASH },
      events: events.map((row) => row.event as V2Event),
    })
    expect(chain).toMatchObject({ ok: true })
    holder.discard()
  }, 60_000)

  it('hands a drained mid-turn session to a second host that finishes it', async () => {
    const sessionId = 'e2e-session-2'
    const mainThreadId = await newSession({ sessionId, text: 'sleep then echo' })

    const logA = new CollectingLog()
    const logB = new CollectingLog()
    const hostA = makeHolder({
      holderId: 'host-a',
      plane,
      bus,
      sandbox,
      log: logA,
      scripts: { [sessionId]: [sleepCall, { text: 'host a finished' }] },
    })
    await hostA.start()

    await bus.wake(sessionId)
    const leaseA = await waitForLease({ plane, sessionId, holderId: 'host-a' })
    await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched'),
    })

    const hostB = makeHolder({
      holderId: 'host-b',
      plane,
      bus,
      sandbox,
      log: logB,
      scripts: { [sessionId]: [{ text: 'host b finished' }] },
    })
    await hostB.start()

    await hostA.drain({ deadline: Date.now() + 500 })
    await bus.wake(sessionId)

    const events = await waitForSeq({
      plane,
      threadId: mainThreadId,
      want: (rows) => rows.some(isDoneResult),
      timeoutMs: 60_000,
    }).catch(async (error: unknown) => {
      const row = await plane.readSession({ sessionId })
      const last = await readAllEvents({ plane, threadId: mainThreadId })
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${logA.dump('hostA')}\n${logB.dump('hostB')}\nlease: ${JSON.stringify(row)}\nevents: ${JSON.stringify(last)}`,
      )
    })
    const leaseB = await plane.currentLease({ sessionId })
    expect(leaseB.lease.holderId).toBe('host-b')
    expect(leaseB.lease.epoch).toBeGreaterThan(leaseA.epoch)
    const dispatches = events.filter((row) => row.type === 'tool-dispatched')
    const results = events.filter((row) => row.type === 'tool-result')
    expect(dispatches.length).toBe(1)
    expect(results.length).toBe(1)
    const result = results[0]?.event as { error?: unknown; output?: unknown } | undefined
    expect(result?.error).toBeUndefined()
    expect(results.filter(isDoneResult).length).toBe(1)
    hostA.discard()
    hostB.discard()
  }, 90_000)
})
