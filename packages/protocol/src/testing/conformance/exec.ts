import { describe, expect, it } from 'bun:test'

import { ECallFailure, EExecOutcome } from '../../ops'
import {
  EPOCH,
  connectAt,
  failureOf,
  okValue,
  replyOf,
  resultOf,
  runToEnd,
  sendRun,
  shell,
  sleep,
  streamOf,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

export const describeExecConformance = (target: DaemonConformanceTarget): void => {
  describe(`exec conformance (${target.name})`, () => {
    it('reports the exit code and the output size', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const result = await runToEnd({ session, key: 'e-exit', op: shell('echo hi; exit 3') })
          expect(okValue({ result, op: 'exec' })).toEqual({
            exitCode: 3,
            signal: null,
            outcome: EExecOutcome.Exited,
            outputBytes: 3,
          })
        },
      }))

    it('closes stdin so a reader of it ends at once', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const result = await runToEnd({
            session,
            key: 'e-stdin',
            op: { op: 'exec', argv: ['cat'] },
            timeoutMs: 3000,
          })
          expect(okValue({ result, op: 'exec' }).exitCode).toBe(0)
        },
      }))

    it('settles a bad executable and a bad cwd as a failed result', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const missing = await runToEnd({
            session,
            key: 'e-missing',
            op: { op: 'exec', argv: ['/nonexistent/tool'] },
          })
          expect(failureOf(missing)).toBe(ECallFailure.SpawnFailed)
          const badCwd = await runToEnd({
            session,
            key: 'e-cwd',
            op: shell('true', { cwd: '/nonexistent-dir' }),
          })
          expect(failureOf(badCwd)).toBe(ECallFailure.SpawnFailed)
        },
      }))

    it('ends a call on cancel with the cancelled outcome', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          sendRun({ session, key: 'e-cancel', op: shell('sleep 30') })
          await replyOf({ session, key: 'e-cancel' })
          session.send({ kind: 'cancel', key: 'e-cancel', epoch: EPOCH })
          const result = await resultOf({ session, key: 'e-cancel', timeoutMs: 5000 })
          expect(okValue({ result, op: 'exec' }).outcome).toBe(EExecOutcome.Cancelled)
        },
      }))

    it('ends a call at its timeout with the timed-out outcome', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const result = await runToEnd({
            session,
            key: 'e-timeout',
            op: shell('sleep 30', { timeoutMs: 200 }),
            timeoutMs: 5000,
          })
          expect(okValue({ result, op: 'exec' }).outcome).toBe(EExecOutcome.TimedOut)
        },
      }))

    it('kills every descendant on cancel, and the result is not held by their pipes', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        sendRun({ session, key: 'e-tree', op: shell('sleep 30 & echo $!; wait') })
        await session.until((frame) => frame.kind === 'output' && frame.key === 'e-tree')
        const child = Number(streamOf({ session, key: 'e-tree' }).trim())
        expect(handle.processAlive(child)).toBe(true)
        session.send({ kind: 'cancel', key: 'e-tree', epoch: EPOCH })
        const result = await resultOf({ session, key: 'e-tree', timeoutMs: 5000 })
        expect(okValue({ result, op: 'exec' }).outcome).toBe(EExecOutcome.Cancelled)
        await sleep(100)
        expect(handle.processAlive(child)).toBe(false)
      } finally {
        await handle.stop()
      }
    })
  })
}
