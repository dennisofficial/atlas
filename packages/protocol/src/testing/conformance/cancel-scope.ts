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

export const describeCancelScopeConformance = (target: DaemonConformanceTarget): void => {
  describe(`cancel-scope conformance (${target.name})`, () => {
    it('cancels every running call under the scope and leaves another scope running', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          sendRun({ session, key: 's.0', op: shell('sleep 30') })
          sendRun({ session, key: 's.1', op: shell('sleep 30') })
          sendRun({ session, key: 't.0', op: shell('echo other') })
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
          expect(
            okValue({ result: await resultOf({ session, key: 't.0' }), op: 'exec' }).outcome,
          ).toBe(EExecOutcome.Exited)
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
