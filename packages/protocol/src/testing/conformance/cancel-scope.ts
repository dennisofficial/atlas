import { describe, expect, it } from 'bun:test'

import { EDaemonErrorKind } from '../../frames'
import { EExecOutcome } from '../../ops'
import type { DaemonSession } from '../client'
import {
  EPOCH,
  connectAt,
  errorOf,
  okValue,
  replyOf,
  resultOf,
  sendRun,
  shell,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

const scopeCancelledOf = async (session: DaemonSession): Promise<readonly string[]> => {
  const frame = await session.until((candidate) => candidate.kind === 'scope-cancelled', {
    label: 'scope-cancelled',
  })
  if (frame.kind !== 'scope-cancelled') throw new Error('unreachable')
  return frame.cancelled
}

const resultArrived = (args: { session: DaemonSession; key: string }): boolean =>
  args.session.frames().some((frame) => frame.kind === 'result' && frame.key === args.key)

const cancelOne = (args: { session: DaemonSession; key: string }): void => {
  args.session.send({ kind: 'cancel', key: args.key, epoch: EPOCH })
}

export const describeCancelScopeConformance = (target: DaemonConformanceTarget): void => {
  describe(`cancel-scope conformance (${target.name})`, () => {
    it('cancels every running call under the scope and leaves another scope running', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          sendRun({ session, key: 's.0', op: shell('sleep 30') })
          sendRun({ session, key: 's.1', op: shell('sleep 30') })
          sendRun({ session, key: 't.0', op: shell('sleep 30') })
          await replyOf({ session, key: 's.0' })
          await replyOf({ session, key: 's.1' })
          await replyOf({ session, key: 't.0' })

          session.send({ kind: 'cancel-scope', scope: 's', epoch: EPOCH })
          const cancelled = await scopeCancelledOf(session)

          expect([...cancelled].sort()).toEqual(['s.0', 's.1'])
          expect(
            okValue({ result: await resultOf({ session, key: 's.0' }), op: 'exec' }).outcome,
          ).toBe(EExecOutcome.Cancelled)
          expect(
            okValue({ result: await resultOf({ session, key: 's.1' }), op: 'exec' }).outcome,
          ).toBe(EExecOutcome.Cancelled)
          expect(resultArrived({ session, key: 't.0' })).toBe(false)
          cancelOne({ session, key: 't.0' })
          expect(
            okValue({ result: await resultOf({ session, key: 't.0' }), op: 'exec' }).outcome,
          ).toBe(EExecOutcome.Cancelled)
        },
      }))

    it('takes every step key of the scope and no key that only starts with its text', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const steps = ['c1.0', 'c1.read.0123abcd', 'c1.no-step.deadbeef']
          for (const key of [...steps, 'c1.0.0']) {
            sendRun({ session, key, op: shell('sleep 30') })
            await replyOf({ session, key })
          }

          session.send({ kind: 'cancel-scope', scope: 'c1', epoch: EPOCH })
          const cancelled = await scopeCancelledOf(session)

          expect([...cancelled].sort()).toEqual([...steps].sort())
          for (const key of steps)
            expect(okValue({ result: await resultOf({ session, key }), op: 'exec' }).outcome).toBe(
              EExecOutcome.Cancelled,
            )
          expect(resultArrived({ session, key: 'c1.0.0' })).toBe(false)
          cancelOne({ session, key: 'c1.0.0' })
          expect(
            okValue({ result: await resultOf({ session, key: 'c1.0.0' }), op: 'exec' }).outcome,
          ).toBe(EExecOutcome.Cancelled)
        },
      }))

    it('replies with an empty list for a scope that has nothing running', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          session.send({ kind: 'cancel-scope', scope: 'nothing', epoch: EPOCH })
          expect(await scopeCancelledOf(session)).toEqual([])
        },
      }))

    it('refuses a frame epoch that differs from the hello epoch, as a cancel does', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle, epoch: EPOCH + 1 })
          session.send({ kind: 'cancel', key: 's.0', epoch: EPOCH })
          expect(await errorOf({ session, key: 's.0' })).toBe(EDaemonErrorKind.InvalidFrame)
          session.send({ kind: 'cancel-scope', scope: 's', epoch: EPOCH })
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.InvalidFrame)
        },
      }))
  })
}
