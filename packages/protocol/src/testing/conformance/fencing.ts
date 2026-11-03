import { describe, expect, it } from 'bun:test'

import { EDaemonErrorKind } from '../../frames'
import {
  ERunState,
  ackOf,
  closedWithin,
  connectAt,
  errorOf,
  hello,
  replyOf,
  resultOf,
  runToEnd,
  runsOf,
  sendRun,
  shell,
  sleep,
  streamOf,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

export const describeFencingConformance = (target: DaemonConformanceTarget): void => {
  describe(`fencing conformance (${target.name})`, () => {
    it('closes a connection with a bad token', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await handle.connect()
          session.send({ kind: 'hello', sessionId: 's', epoch: 1, token: 'wrong-token' })
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.Unauthenticated)
          expect(await closedWithin({ session, ms: 2000 })).not.toBeNull()
        },
      }))

    it('refuses a token minted for a different sandbox name', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await handle.connect()
          const foreign = handle.foreignToken({ sandboxName: 'atlas-v2-other-sandbox' })
          session.send({ kind: 'hello', sessionId: 's', epoch: 1, token: foreign })
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.Unauthenticated)
          expect(await closedWithin({ session, ms: 2000 })).not.toBeNull()
        },
      }))

    it('refuses a token minted with a different secret for the same sandbox name', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await handle.connect()
          const foreign = handle.foreignToken({ secret: 'another-secret' })
          session.send({ kind: 'hello', sessionId: 's', epoch: 1, token: foreign })
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.Unauthenticated)
          expect(await closedWithin({ session, ms: 2000 })).not.toBeNull()
        },
      }))

    it('refuses run before hello and runs nothing', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await handle.connect()
          sendRun({ session, key: 'k-early', op: shell('echo nope') })
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.Unauthenticated)
          await hello({ session, epoch: 7, token: handle.token })
          expect(await runsOf(session)).toBe(0)
        },
      }))

    it('refuses a frame whose epoch differs from its hello and an invalid frame', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          sendRun({ session, key: 'k-epoch', op: shell('echo x'), epoch: 9 })
          expect(await errorOf({ session, key: 'k-epoch' })).toBe(EDaemonErrorKind.InvalidFrame)
          session.sendRaw(
            '{"kind":"run","key":"../escape","epoch":7,"op":{"op":"stat","path":"/"}}',
          )
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.InvalidFrame)
          session.sendRaw('not json')
          expect(await errorOf({ session })).toBe(EDaemonErrorKind.InvalidFrame)
          expect(await runsOf(session)).toBe(0)
        },
      }))

    it('closes the older connection on takeover and refuses its later frames', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const older = await connectAt({ handle, epoch: 5 })
          await connectAt({ handle, epoch: 6 })
          expect(await closedWithin({ session: older, ms: 2000 })).not.toBeNull()
          sendRun({ session: older, key: 'k-stale', op: shell('echo stale'), epoch: 5 })
          await sleep(100)
          const probe = await connectAt({ handle, epoch: 6 })
          expect(await runsOf(probe)).toBe(0)
        },
      }))

    it('refuses a hello below the highest epoch ever seen, even after it disconnected', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const high = await connectAt({ handle, epoch: 7 })
          high.close()
          await high.closed
          const low = await handle.connect()
          low.send({ kind: 'hello', sessionId: 's', epoch: 5, token: handle.token })
          expect(await errorOf({ session: low })).toBe(EDaemonErrorKind.StaleEpoch)
          expect(await closedWithin({ session: low, ms: 2000 })).not.toBeNull()
          const same = await connectAt({ handle, epoch: 7 })
          expect(await runsOf(same)).toBe(0)
        },
      }))

    it('hands a call running across a takeover to the new holder', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const op = shell('echo before; sleep 0.4; echo after')
          const older = await connectAt({ handle, epoch: 5 })
          sendRun({ session: older, key: 'k-move', op, epoch: 5 })
          await older.until((frame) => frame.kind === 'output' && frame.key === 'k-move')
          const newer = await connectAt({ handle, epoch: 6 })
          sendRun({ session: newer, key: 'k-move', op, epoch: 6 })
          expect(await replyOf({ session: newer, key: 'k-move' })).toBe(ERunState.Running)
          await resultOf({ session: newer, key: 'k-move' })
          expect(streamOf({ session: newer, key: 'k-move' })).toBe('before\nafter\n')
          expect(older.frames().some((frame) => frame.kind === 'result')).toBe(false)
          expect(await runsOf(newer)).toBe(1)
        },
      }))

    it('keeps a stored result when a zombie at an old epoch acks it', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const zombie = await connectAt({ handle, epoch: 5 })
          await runToEnd({ session: zombie, key: 'k-zombie', op: shell('echo kept'), epoch: 5 })
          const holder = await connectAt({ handle, epoch: 6 })
          zombie.send({ kind: 'ack', key: 'k-zombie', epoch: 5 })
          await sleep(100)
          sendRun({ session: holder, key: 'k-zombie', op: shell('echo kept'), epoch: 6 })
          expect(await replyOf({ session: holder, key: 'k-zombie' })).toBe(ERunState.Done)
          await resultOf({ session: holder, key: 'k-zombie' })
          expect(await ackOf({ session: holder, key: 'k-zombie', epoch: 6 })).toBe('acked')
          expect(await ackOf({ session: holder, key: 'k-zombie', epoch: 6 })).toBe(
            EDaemonErrorKind.UnknownKey,
          )
        },
      }))
  })
}
