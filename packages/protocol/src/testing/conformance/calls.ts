import { describe, expect, it } from 'bun:test'

import { EDaemonErrorKind } from '../../frames'
import { EExecOutcome } from '../../ops'
import {
  ERunState,
  ackOf,
  connectAt,
  errorOf,
  okValue,
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

export const describeCallsConformance = (target: DaemonConformanceTarget): void => {
  describe(`calls conformance (${target.name})`, () => {
    it('spawns once for two runs of one key sent back to back', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          sendRun({ session, key: 'k-dup', op: shell('sleep 0.2; echo once') })
          sendRun({ session, key: 'k-dup', op: shell('sleep 0.2; echo once') })
          await replyOf({ session, key: 'k-dup' })
          await replyOf({ session, key: 'k-dup' })
          await resultOf({ session, key: 'k-dup' })
          await resultOf({ session, key: 'k-dup' })
          expect(await runsOf(session)).toBe(1)
          expect(streamOf({ session, key: 'k-dup' })).toBe('once\n')
        },
      }))

    it('answers done with the stored output and result for a finished key', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const first = await runToEnd({ session, key: 'k-done', op: shell('echo stored') })
          expect(okValue({ result: first, op: 'exec' }).outcome).toBe(EExecOutcome.Exited)
          const again = await connectAt({ handle })
          sendRun({ session: again, key: 'k-done', op: shell('echo stored') })
          expect(await replyOf({ session: again, key: 'k-done' })).toBe(ERunState.Done)
          expect(await resultOf({ session: again, key: 'k-done' })).toEqual(first)
          expect(streamOf({ session: again, key: 'k-done' })).toBe('stored\n')
          expect(await runsOf(again)).toBe(1)
        },
      }))

    it('refuses to ack a running call, which still finishes and is not respawned', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          sendRun({ session, key: 'k-early', op: shell('sleep 0.3; echo late') })
          await replyOf({ session, key: 'k-early' })
          expect(await ackOf({ session, key: 'k-early' })).toBe(EDaemonErrorKind.NotDone)
          await resultOf({ session, key: 'k-early' })
          sendRun({ session, key: 'k-early', op: shell('sleep 0.3; echo late') })
          expect(await replyOf({ session, key: 'k-early' })).toBe(ERunState.Done)
          expect(await runsOf(session)).toBe(1)
          expect(await ackOf({ session, key: 'k-early' })).toBe('acked')
          expect(await ackOf({ session, key: 'k-early' })).toBe(EDaemonErrorKind.UnknownKey)
        },
      }))

    it('sends the result only after every output chunk, in offset order across both streams', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const script = 'echo a; sleep 0.05; echo b >&2; sleep 0.05; echo c; echo d >&2'
          await runToEnd({ session, key: 'k-mixed', op: shell(script) })
          expect(streamOf({ session, key: 'k-mixed' })).toBe('a\nb\nc\nd\n')
          const frames = session
            .frames()
            .filter((frame) => 'key' in frame && frame.key === 'k-mixed')
          expect(frames.map((frame) => frame.kind).filter((kind) => kind !== 'output')).toEqual([
            'run-reply',
            'result',
          ])
          expect(frames.at(-1)?.kind).toBe('result')
          await sleep(100)
          expect(session.frames().filter((frame) => frame.kind === 'result').length).toBe(1)

          const replay = await connectAt({ handle })
          await runToEnd({ session: replay, key: 'k-mixed', op: shell(script) })
          expect(streamOf({ session: replay, key: 'k-mixed' })).toBe('a\nb\nc\nd\n')
        },
      }))

    it('streams nothing twice when one socket runs a live key again', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const op = shell('echo one; sleep 0.2; echo two; sleep 0.2; echo three')
          sendRun({ session, key: 'k-again', op })
          await session.until((frame) => frame.kind === 'output' && frame.key === 'k-again')
          sendRun({ session, key: 'k-again', op })
          await resultOf({ session, key: 'k-again' })
          await resultOf({ session, key: 'k-again' })
          expect(streamOf({ session, key: 'k-again' })).toBe('one\ntwo\nthree\n')
        },
      }))

    it('reattaches after a dropped link from the offset it asks for', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const op = shell('echo first; sleep 0.4; echo second')
          const before = await connectAt({ handle })
          sendRun({ session: before, key: 'k-gap', op })
          await before.until((frame) => frame.kind === 'output' && frame.key === 'k-gap')
          const seen = streamOf({ session: before, key: 'k-gap' })
          before.close()
          await before.closed

          const after = await connectAt({ handle })
          const fromOffset = Buffer.byteLength(seen)
          sendRun({ session: after, key: 'k-gap', op, fromOffset })
          await replyOf({ session: after, key: 'k-gap' })
          await resultOf({ session: after, key: 'k-gap' })
          expect(seen + streamOf({ session: after, key: 'k-gap', from: fromOffset })).toBe(
            'first\nsecond\n',
          )
          expect(await runsOf(after)).toBe(1)
        },
      }))

    it('finishes a call with nobody connected and hands the result to the next connection', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const first = await connectAt({ handle })
          sendRun({ session: first, key: 'k-alone', op: shell('sleep 0.1; echo alone') })
          await replyOf({ session: first, key: 'k-alone' })
          first.close()
          await sleep(300)
          const next = await connectAt({ handle })
          sendRun({ session: next, key: 'k-alone', op: shell('sleep 0.1; echo alone') })
          expect(await replyOf({ session: next, key: 'k-alone' })).toBe(ERunState.Done)
          await resultOf({ session: next, key: 'k-alone' })
          expect(streamOf({ session: next, key: 'k-alone' })).toBe('alone\n')
        },
      }))

    it('refuses an unknown key on ack and cancel', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          expect(await ackOf({ session, key: 'k-ghost' })).toBe(EDaemonErrorKind.UnknownKey)
          session.send({ kind: 'cancel', key: 'k-ghost', epoch: 7 })
          expect(await errorOf({ session, key: 'k-ghost' })).toBe(EDaemonErrorKind.UnknownKey)
        },
      }))

    it('prunes every call when the daemon restarts on the same disk under a new bootId', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await runToEnd({ session, key: 'k-pruned', op: shell('echo lost') })
          sendRun({ session, key: 'k-pruned-live', op: shell('sleep 5') })
          await replyOf({ session, key: 'k-pruned-live' })
          const before = handle.bootId()
          await handle.restart()
          expect(handle.bootId()).not.toBe(before)
          const after = await connectAt({ handle })
          expect(await ackOf({ session: after, key: 'k-pruned' })).toBe(EDaemonErrorKind.UnknownKey)
          expect(await runsOf(after)).toBe(0)
          sendRun({ session: after, key: 'k-pruned-live', op: shell('echo fresh') })
          expect(await replyOf({ session: after, key: 'k-pruned-live' })).toBe(ERunState.Running)
          await resultOf({ session: after, key: 'k-pruned-live' })
          expect(streamOf({ session: after, key: 'k-pruned-live' })).toBe('fresh\n')
        },
      }))
  })
}
