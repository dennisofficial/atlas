import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import {
  callIdOf,
  expectOneResultPerDispatch,
  isDoneResult,
  makeFifo,
  readEvents,
  waitForFile,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const waitForDoneJournal = async (args: { home: string; timeoutMs: number }): Promise<string> => {
  const root = join(args.home, 'daemon', 'calls')
  const deadline = Date.now() + args.timeoutMs
  while (Date.now() < deadline) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(root, entry.name, 'state.json')
      try {
        if (readFileSync(path, 'utf8').includes('"state":"done"')) return path
      } catch {}
    }
    await sleep(50)
  }
  throw new Error(`no done journal under ${root} within ${args.timeoutMs} ms`)
}

describe.skipIf(REDIS_URL === undefined)('F44 a finished call survives a daemon restart', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('the next holder collects the result the old daemon finished, and never reruns it', async () => {
    const sessionId = 'fault-f44-1'
    const threadId = await rig.newSession({ sessionId, text: 'run then collect' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const firstBoot = daemon.bootId
    const startedFile = join(daemon.home, `started-${sessionId}`)
    const gateFifo = join(daemon.home, `gate-${sessionId}`)
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    makeFifo({ path: gateFifo })
    const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`

    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      scripts: {
        [sessionId]: [
          {
            calls: [{ callId: 'c1', name: 'bash', input: { description: 'gated', command: bash } }],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await rig.claim({ sessionId, label: 'host-a', timeoutMs: 30_000 })
    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      timeoutMs: 30_000,
    })
    await waitForFile({ path: startedFile })

    daemon.proxy.set({ holdDownstream: true })
    writeFileSync(gateFifo, 'go\n')
    await waitForDoneJournal({ home: daemon.home, timeoutMs: 30_000 })

    const mid = await readEvents({ plane: rig.plane, threadId })
    expect(mid.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(false)

    hostA.kill('SIGKILL')
    await hostA.exited
    await daemon.restart({ keepHome: true })
    expect(daemon.bootId).not.toBe(firstBoot)
    daemon.proxy.clear()

    const hostB = await rig.spawnHost({
      label: 'host-b',
      daemonUrl: daemon.url,
      scripts: { [sessionId]: [{ text: 'host b collected' }] },
    })
    await rig.claim({ sessionId, label: 'host-b', timeoutMs: 30_000 })

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) => rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
        )
      })

    const dispatches = events.filter(
      (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
    )
    const results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
    expect(dispatches).toHaveLength(1)
    expect(dispatches.map((row) => (row.event as { bootId?: string }).bootId)).toEqual([firstBoot])
    expect(results).toHaveLength(1)
    expect(results.map((row) => (row.event as { interrupted?: boolean }).interrupted)).toEqual([
      undefined,
    ])
    expectOneResultPerDispatch(events)

    expect(readFileSync(runsFile, 'utf8').trim().split('\n')).toEqual(['run'])

    const lease = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-b')
  }, 90_000)
})
