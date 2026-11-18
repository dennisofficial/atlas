import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { useTestDatabase } from '@dltech/atlas-db/testing'

import { startRig, type FaultRig } from '../../testing/fault-rig'
import {
  callIdOf,
  expectEpochsOrdered,
  expectOneResultPerDispatch,
  isDoneResult,
  makeFifo,
  readEvents,
  releaseFifo,
} from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

const waitForText = async (args: {
  path: string
  text: string
  timeoutMs?: number
}): Promise<void> => {
  const deadline = Date.now() + (args.timeoutMs ?? 20_000)
  while (Date.now() < deadline) {
    try {
      if (readFileSync(args.path, 'utf8').includes(args.text)) return
    } catch {
      // the tap file does not exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${args.text} in ${args.path}`)
}

describe.skipIf(REDIS_URL === undefined)('F3 daemon link dropped mid-bash, back in 3 s', () => {
  const testDb = useTestDatabase()
  let rig: FaultRig

  beforeAll(async () => {
    rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
  }, 60_000)

  afterAll(async () => {
    await rig.stop()
  })

  it('reattaches at the offset; output is neither doubled nor missing', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const sessionId = `fault-f03-${suffix}`
    const threadId = await rig.newSession({ sessionId, text: 'stream lines' })
    const daemon = await rig.spawnDaemonFor({ sessionId })
    const tapDir = mkdtempSync(join(tmpdir(), `atlas-fault-f03-tap-${suffix}-`))
    const tapFile = join(tapDir, 'tool-output.log')
    const startedFile = join(daemon.home, `started-${sessionId}`)
    const gateFifo = join(daemon.home, `gate-${sessionId}`)
    const runsFile = join(daemon.home, `runs-${sessionId}`)
    makeFifo({ path: gateFifo })
    const before = Array.from({ length: 5 }, (_, i) => `before-${i + 1}`)
    const during = Array.from({ length: 5 }, (_, i) => `during-${i + 1}`)
    const after = Array.from({ length: 5 }, (_, i) => `after-${i + 1}`)
    const emit = (lines: string[], gap: string): string =>
      lines.map((line) => `echo ${line}; sleep ${gap}`).join('; ')
    const bash = [
      `touch ${startedFile}`,
      `echo run >> ${runsFile}`,
      emit(before, '0.2'),
      emit(during, '0.6'),
      `cat ${gateFifo}`,
      emit(after, '0.05'),
      'echo done',
    ].join('; ')

    const hostA = await rig.spawnHost({
      label: 'host-a',
      daemonUrl: daemon.url,
      knobs: { toolOutputFile: tapFile },
      scripts: {
        [sessionId]: [
          {
            calls: [
              { callId: 'c1', name: 'bash', input: { description: 'stream', command: bash } },
            ],
          },
          { text: 'host a finished' },
        ],
      },
    })
    await rig.claim({ sessionId, label: 'host-a' })
    await rig.waitForSeq({
      threadId,
      want: (rows) => rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
      timeoutMs: 20_000,
    })
    await waitForText({ path: tapFile, text: 'before-5' })

    const beforeDrop = await readEvents({ plane: rig.plane, threadId })
    expect(beforeDrop.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(
      false,
    )

    daemon.proxy.set({ refuse: true })
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    daemon.proxy.clear()
    await releaseFifo({ path: gateFifo })

    const events = await rig
      .waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => callIdOf(row) === 'c1' && isDoneResult(row)) &&
          rows.some((row) => row.type === 'assistant-said'),
        timeoutMs: 30_000,
      })
      .catch((error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nhostA logs:\n${hostA.logs().join('\n')}`,
        )
      })

    expectOneResultPerDispatch(events)
    const result = events.find((row) => callIdOf(row) === 'c1' && isDoneResult(row))?.event as {
      output?: { stdout?: string }
    }
    const stdout = result.output?.stdout ?? ''
    const expected = [...before, ...during, 'go', ...after, 'done'].join('\n')
    expect(stdout.trim()).toBe(expected)

    const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
    expect(runs).toEqual(['run'])

    const lease = await rig.plane.currentLease({ sessionId })
    expect(await rig.labelOf(lease.lease.holderHostId)).toBe('host-a')
    expectEpochsOrdered({ events, finalEpoch: lease.lease.epoch })
  }, 60_000)
})
