import { describe, expect, it } from 'bun:test'

import { ECallFailure, EShellRunStatus } from '../../ops'
import {
  connectAt,
  failureOf,
  replyOf,
  resultOf,
  sendRun,
  sleep,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'
import {
  killShell,
  launchShell,
  launchShellOp,
  listShells,
  readShell,
  readShellText,
  untilShellEnded,
  writeShell,
} from './shells-support'

export const describeShellsConformance = (target: DaemonConformanceTarget): void => {
  describe(`shells conformance (${target.name})`, () => {
    it('launches a shell, publishes output events and reads at offsets with no gap', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const info = await launchShell({ session, key: 's-out', command: 'echo one; echo two' })
          expect(info.status).toBe(EShellRunStatus.Running)
          expect(info.pid).toBeGreaterThan(0)
          const output = await session.until(
            (frame) =>
              frame.kind === 'event' &&
              frame.event.type === 'shells.output' &&
              frame.event.shellId === 's-out',
            { label: 'shells.output s-out' },
          )
          if (output.kind !== 'event' || output.event.type !== 'shells.output') {
            throw new Error('unreachable')
          }
          expect(output.event.totalBytes).toBeGreaterThan(0)
          await untilShellEnded({ session, shellId: 's-out' })

          const first = await readShellText({ session, shellId: 's-out', offset: 0 })
          expect(first.text).toBe('one\ntwo\n')
          expect(first.offset).toBe(0)
          expect(first.totalBytes).toBe(8)
          expect(first.info.status).toBe(EShellRunStatus.Exited)
          expect(first.info.exitCode).toBe(0)

          const middle = await readShellText({ session, shellId: 's-out', offset: 4 })
          expect(middle.text).toBe('two\n')
          const pastEnd = await readShellText({ session, shellId: 's-out', offset: 8 })
          expect(pastEnd.text).toBe('')
          expect(pastEnd.totalBytes).toBe(8)
        },
      }))

    it('writes to and ends the input of a cat shell', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await launchShell({ session, key: 's-cat', command: 'cat', input: true })
          expect(await writeShell({ session, shellId: 's-cat', data: 'hello\n' })).toBeNull()
          await session.until(
            (frame) =>
              frame.kind === 'event' &&
              frame.event.type === 'shells.output' &&
              frame.event.shellId === 's-cat',
            { label: 'shells.output s-cat' },
          )
          expect(await writeShell({ session, shellId: 's-cat', data: '', end: true })).toBeNull()
          await untilShellEnded({ session, shellId: 's-cat' })
          const chunk = await readShellText({ session, shellId: 's-cat', offset: 0 })
          expect(chunk.text).toBe('hello\n')
          expect(chunk.info.status).toBe(EShellRunStatus.Exited)
          expect(await writeShell({ session, shellId: 's-cat', data: 'x' })).toBe(
            ECallFailure.InvalidInput,
          )
        },
      }))

    it('refuses to write to a shell launched without input', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await launchShell({ session, key: 's-noinput', command: 'sleep 30' })
          expect(await writeShell({ session, shellId: 's-noinput', data: 'x' })).toBe(
            ECallFailure.InvalidInput,
          )
          await killShell({ session, shellId: 's-noinput' })
        },
      }))

    it('kills a running shell and its backgrounded grandchild (real processes only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        sendRun({
          session,
          key: 's-tree',
          op: launchShellOp({ shellId: 's-tree', command: 'sleep 30 & echo $!; wait' }),
        })
        await replyOf({ session, key: 's-tree' })
        await session.until(
          (frame) =>
            frame.kind === 'event' &&
            frame.event.type === 'shells.output' &&
            frame.event.shellId === 's-tree',
          { label: 'shells.output s-tree' },
        )
        const chunk = await readShellText({ session, shellId: 's-tree', offset: 0 })
        const grandchild = Number(chunk.text.trim())
        expect(grandchild).toBeGreaterThan(0)
        expect(handle.processAlive(grandchild)).toBe(true)
        const info = await killShell({ session, shellId: 's-tree' })
        expect(info.status).toBe(EShellRunStatus.Killed)
        await sleep(100)
        expect(handle.processAlive(grandchild)).toBe(false)
      } finally {
        await handle.stop()
      }
    })

    it('marks a shell timed-out at its timeout', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await launchShell({ session, key: 's-timeout', command: 'sleep 30', timeoutMs: 200 })
          await untilShellEnded({ session, shellId: 's-timeout' })
          const chunk = await readShell({ session, shellId: 's-timeout', offset: 0 })
          expect(chunk.info.status).toBe(EShellRunStatus.TimedOut)
        },
      }))

    it('keeps a shell running across a reconnect and a takeover, and the new holder reads it', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const first = await connectAt({ handle, epoch: 5 })
          await launchShell({ session: first, key: 's-stay', command: 'sleep 30', epoch: 5 })
          first.close()
          await first.closed

          const reconnected = await connectAt({ handle, epoch: 5 })
          const listed = await listShells({ session: reconnected, key: 'list-1', epoch: 5 })
          const found = listed.find((info) => info.shellId === 's-stay')
          expect(found?.status).toBe(EShellRunStatus.Running)

          const holder = await connectAt({ handle, epoch: 6 })
          const again = await listShells({ session: holder, key: 'list-2', epoch: 6 })
          expect(again.find((info) => info.shellId === 's-stay')?.status).toBe(
            EShellRunStatus.Running,
          )
          const info = await killShell({ session: holder, shellId: 's-stay', epoch: 6 })
          expect(info.status).toBe(EShellRunStatus.Killed)
          const after = await listShells({ session: holder, key: 'list-3', epoch: 6 })
          expect(after.find((entry) => entry.shellId === 's-stay')?.status).toBe(
            EShellRunStatus.Killed,
          )
        },
      }))

    it('fails a duplicate launch with already-exists and unknown ids with not-found', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await launchShell({ session, key: 's-dupe', command: 'echo ok' })
          sendRun({
            session,
            key: 'launch-dupe',
            op: launchShellOp({ shellId: 's-dupe', command: 'echo again' }),
          })
          await replyOf({ session, key: 'launch-dupe' })
          expect(failureOf(await resultOf({ session, key: 'launch-dupe' }))).toBe(
            ECallFailure.AlreadyExists,
          )

          sendRun({
            session,
            key: 'read-missing',
            op: { op: 'shells.read', shellId: 's-missing', offset: 0, limit: 10 },
          })
          await replyOf({ session, key: 'read-missing' })
          expect(failureOf(await resultOf({ session, key: 'read-missing' }))).toBe(
            ECallFailure.NotFound,
          )

          sendRun({
            session,
            key: 'write-missing',
            op: { op: 'shells.write', shellId: 's-missing', data: 'x' },
          })
          await replyOf({ session, key: 'write-missing' })
          expect(failureOf(await resultOf({ session, key: 'write-missing' }))).toBe(
            ECallFailure.NotFound,
          )

          sendRun({
            session,
            key: 'kill-missing',
            op: { op: 'shells.kill', shellId: 's-missing' },
          })
          await replyOf({ session, key: 'kill-missing' })
          expect(failureOf(await resultOf({ session, key: 'kill-missing' }))).toBe(
            ECallFailure.NotFound,
          )
          await killShell({ session, shellId: 's-dupe' })
        },
      }))

    it('caps stored output at the limit while totalBytes keeps counting', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await launchShell({
            session,
            key: 's-limit',
            command: 'echo aaa; echo bbb',
            outputLimitBytes: 4,
          })
          await untilShellEnded({ session, shellId: 's-limit' })
          const chunk = await readShellText({ session, shellId: 's-limit', offset: 0 })
          expect(chunk.text).toBe('aaa\n')
          expect(chunk.totalBytes).toBe(8)
          const rest = await readShellText({ session, shellId: 's-limit', offset: 4 })
          expect(rest.text).toBe('')
          expect(rest.totalBytes).toBe(8)
        },
      }))
  })
}
