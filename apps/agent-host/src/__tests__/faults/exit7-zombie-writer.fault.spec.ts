import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { chainEvents, toRunId, toThreadId } from '@dltech/atlas-core'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { sandboxNameOf } from '../../sandbox/sandbox-provider'
import { RIG_SECRET, startRig, type FaultRig } from '../../testing/fault-rig'
import { callIdOf, isDoneResult, makeFifo, readEvents, waitForFile } from './fault-support'

const REDIS_URL = process.env.ATLAS_TEST_REDIS_URL

type DaemonFrame = { kind?: string; errorKind?: string; key?: string }

type RunOutcome = {
  helloOk: boolean
  runErrorKind: string | undefined
  sawResult: boolean
}

const runOutcome = (args: {
  url: string
  sessionId: string
  helloEpoch: number
  runEpoch: number
}): Promise<RunOutcome> =>
  new Promise((resolve, reject) => {
    const token = daemonToken({
      secret: RIG_SECRET,
      sandboxName: sandboxNameOf(args.sessionId),
    })
    const socket = new WebSocket(args.url)
    const outcome: RunOutcome = { helloOk: false, runErrorKind: undefined, sawResult: false }
    const deadline = setTimeout(() => {
      socket.close()
      resolve(outcome)
    }, 3_000)
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({ kind: 'hello', sessionId: args.sessionId, epoch: args.helloEpoch, token }),
      )
    })
    socket.addEventListener('message', (message) => {
      const frame = JSON.parse(String(message.data)) as DaemonFrame
      if (frame.kind === 'hello-reply') {
        outcome.helloOk = true
        socket.send(
          JSON.stringify({
            kind: 'run',
            key: 'zombie-run',
            epoch: args.runEpoch,
            op: { op: 'exec', argv: ['/bin/sh', '-c', 'echo zombie'] },
          }),
        )
        return
      }
      if (frame.kind === 'error' && frame.key === 'zombie-run') {
        outcome.runErrorKind = frame.errorKind
      }
      if (frame.kind === 'result' && frame.key === 'zombie-run') outcome.sawResult = true
    })
    socket.addEventListener('error', () => {
      clearTimeout(deadline)
      reject(new Error('the daemon socket failed'))
    })
  })

const helloOutcome = (args: {
  url: string
  sessionId: string
  epoch: number
}): Promise<{ errorKind: string | undefined; closeCode: number | undefined }> =>
  new Promise((resolve, reject) => {
    const token = daemonToken({
      secret: RIG_SECRET,
      sandboxName: sandboxNameOf(args.sessionId),
    })
    const socket = new WebSocket(args.url)
    let errorKind: string | undefined
    const deadline = setTimeout(() => reject(new Error('no error frame within 10 s')), 10_000)
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({ kind: 'hello', sessionId: args.sessionId, epoch: args.epoch, token }),
      )
    })
    socket.addEventListener('message', (message) => {
      const frame = JSON.parse(String(message.data)) as DaemonFrame
      if (frame.kind === 'error') errorKind = frame.errorKind
    })
    socket.addEventListener('close', (event) => {
      clearTimeout(deadline)
      resolve({ errorKind, closeCode: event.code })
    })
    socket.addEventListener('error', () => undefined)
  })

describe.skipIf(REDIS_URL === undefined)(
  'exit test 7 + F16 second writer refused, zombie host fenced (TTL 30 s scaled to 3 s)',
  () => {
    const testDb = useTestDatabase()
    let rig: FaultRig

    beforeAll(async () => {
      rig = await startRig({ databaseUrl: testDb().url, redisUrl: REDIS_URL ?? '' })
    }, 60_000)

    afterAll(async () => {
      await rig.stop()
    })

    it('refuses a second writer and a partitioned zombie at the store and the daemon', async () => {
      const sessionId = 'fault-exit7-1'
      const threadId = await rig.newSession({ sessionId, text: 'gated bash' })
      const daemon = await rig.spawnDaemonFor({ sessionId })
      const startedFile = join(daemon.home, `started-${sessionId}`)
      const gateFifo = join(daemon.home, `gate-${sessionId}`)
      const runsFile = join(daemon.home, `runs-${sessionId}`)
      makeFifo({ path: gateFifo })
      const bash = `touch ${startedFile}; echo run >> ${runsFile}; cat ${gateFifo}; echo done`

      const hostA = await rig.spawnHost({
        holderId: 'host-a',
        daemonUrl: daemon.url,
        dbProxy: 'own',
        daemonProxy: 'own',
        scripts: {
          [sessionId]: [
            {
              calls: [
                { callId: 'c1', name: 'bash', input: { description: 'gated', command: bash } },
              ],
            },
            { text: 'host a finished' },
          ],
        },
      })
      const aDb = hostA.dbProxy
      const aDaemon = hostA.daemonProxy
      if (aDb === undefined || aDaemon === undefined) {
        throw new Error('the rig did not hand back per-host proxies')
      }

      await rig.claim({ sessionId, holderId: 'host-a' })
      const dispatched = await rig.waitForSeq({
        threadId,
        want: (rows) =>
          rows.some((row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1'),
        timeoutMs: 20_000,
      })
      await waitForFile({ path: startedFile })
      const leaseA = await rig.plane.currentLease({ sessionId })
      expect(leaseA.lease.holderId).toBe('host-a')
      const epochA = leaseA.lease.epoch

      const reused = dispatched.find((row) => row.type === 'tool-dispatched')
      if (reused === undefined) throw new Error('no events recorded yet')
      const secondWriter = await rig.plane.append({
        threadId,
        epoch: epochA,
        events: [reused.event],
      })
      expect(secondWriter).toMatchObject({ ok: false, refusal: { kind: 'seq-mismatch' } })

      aDb.set({ blackhole: true })
      aDaemon.set({ blackhole: true })
      aDb.drop()
      aDaemon.drop()

      const before = await readEvents({ plane: rig.plane, threadId })
      expect(before.some((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')).toBe(false)

      const hostB = await rig.spawnHost({
        holderId: 'host-b',
        daemonUrl: daemon.url,
        scripts: { [sessionId]: [{ text: 'host b finished' }] },
      })
      await rig.claim({ sessionId, holderId: 'host-b', timeoutMs: 20_000 })
      const headAtBClaim = (await rig.plane.head({ threadId })).seq

      writeFileSync(gateFifo, 'go\n')
      const events = await rig
        .waitForSeq({
          threadId,
          want: (rows) =>
            rows.some(
              (row) =>
                row.type === 'assistant-said' &&
                JSON.stringify(row.event).includes('host b finished'),
            ),
          timeoutMs: 30_000,
        })
        .catch((error: unknown) => {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nhostB logs:\n${hostB.logs().join('\n')}`,
          )
        })

      aDb.clear()
      aDaemon.clear()

      const fenced = hostA.logs().some((line) => line.includes('self-fenced'))
      expect(fenced).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 3_000))
      const afterHeal = await readEvents({ plane: rig.plane, threadId })
      const zombieEvents = afterHeal.filter(
        (row) =>
          ((row.event as { epoch?: number }).epoch ?? 0) === epochA && row.seq > headAtBClaim,
      )
      expect(zombieEvents).toEqual([])

      const head = await rig.plane.head({ threadId })
      const zombieWrites = chainEvents({
        threadId: toThreadId(threadId),
        runId: toRunId('run-zombie'),
        epoch: epochA,
        bodies: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'zombie write' }] }],
        from: head,
        at: new Date().toISOString(),
      })
      const staleWrite = await rig.plane.append({ threadId, epoch: epochA, events: zombieWrites })
      expect(staleWrite).toMatchObject({ ok: false, refusal: { kind: 'stale-epoch' } })

      hostB.kill('SIGKILL')
      await hostB.exited

      const outcome = await helloOutcome({ url: daemon.url, sessionId, epoch: epochA })
      expect(outcome.errorKind).toBe('stale-epoch')

      const staleRun = await runOutcome({
        url: daemon.url,
        sessionId,
        helloEpoch: epochA + 1,
        runEpoch: epochA,
      })
      expect(staleRun.helloOk).toBe(true)
      expect(staleRun.runErrorKind).toBeDefined()
      expect(staleRun.sawResult).toBe(false)

      const dispatches = events.filter(
        (row) => row.type === 'tool-dispatched' && callIdOf(row) === 'c1',
      )
      const results = events.filter((row) => row.type === 'tool-result' && callIdOf(row) === 'c1')
      expect(dispatches.length).toBe(1)
      expect(results.length).toBe(1)
      expect(results.filter(isDoneResult).length).toBe(1)

      const runs = readFileSync(runsFile, 'utf8').trim().split('\n')
      expect(runs).toEqual(['run'])

      const finalLease = await rig.plane.currentLease({ sessionId })
      expect(finalLease.lease.holderId).toBe('host-b')
      const epochs = events.map((row) => (row.event as { epoch?: number }).epoch ?? 0)
      expect(Math.max(...epochs)).toBeLessThanOrEqual(finalLease.lease.epoch)
      const sorted = [...epochs].sort((a, b) => a - b)
      expect(epochs).toEqual(sorted)
    }, 90_000)
  },
)
