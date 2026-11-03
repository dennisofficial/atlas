import { describe, expect, it } from 'bun:test'

import {
  type CallOp,
  ECallFailure,
  EShellRunStatus,
  type ShellInfo,
  type ShellsReadResult,
} from '../../ops'
import type { DaemonSession } from '../client'
import {
  connectAt,
  failureOf,
  okValue,
  replyOf,
  resultOf,
  runToEnd,
  sendRun,
  sleep,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

const launchOp = (args: {
  shellId: string
  command: string
  cwd?: string | undefined
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
  input?: boolean | undefined
}): CallOp => ({
  op: 'shells.launch',
  shellId: args.shellId,
  command: args.command,
  cwd: args.cwd ?? '/tmp',
  ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  ...(args.outputLimitBytes === undefined ? {} : { outputLimitBytes: args.outputLimitBytes }),
  ...(args.input === undefined ? {} : { input: args.input }),
})

const launch = async (args: {
  session: DaemonSession
  key: string
  command: string
  epoch?: number | undefined
  timeoutMs?: number | undefined
  outputLimitBytes?: number | undefined
  input?: boolean | undefined
}): Promise<ShellInfo> => {
  const result = await runToEnd({
    session: args.session,
    key: args.key,
    op: launchOp({
      shellId: args.key,
      command: args.command,
      timeoutMs: args.timeoutMs,
      outputLimitBytes: args.outputLimitBytes,
      input: args.input,
    }),
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.launch' })
}

const readShell = async (args: {
  session: DaemonSession
  shellId: string
  offset: number
  epoch?: number | undefined
  limit?: number | undefined
}): Promise<ShellsReadResult> => {
  const result = await runToEnd({
    session: args.session,
    key: `read-${args.shellId}-${args.offset}-${args.limit ?? 0}`,
    op: {
      op: 'shells.read',
      shellId: args.shellId,
      offset: args.offset,
      limit: args.limit ?? 65536,
    },
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.read' })
}

const readText = async (args: {
  session: DaemonSession
  shellId: string
  offset: number
  epoch?: number | undefined
}): Promise<ShellsReadResult & { text: string }> => {
  const chunk = await readShell(args)
  return { ...chunk, text: Buffer.from(chunk.bytes, 'base64').toString('utf8') }
}

let writeKeys = 0

const writeShell = async (args: {
  session: DaemonSession
  shellId: string
  data: string
  epoch?: number | undefined
  end?: boolean | undefined
}): Promise<ReturnType<typeof failureOf> | null> => {
  writeKeys += 1
  const result = await runToEnd({
    session: args.session,
    key: `write-${args.shellId}-${writeKeys}`,
    op: {
      op: 'shells.write',
      shellId: args.shellId,
      data: args.data,
      ...(args.end === undefined ? {} : { end: args.end }),
    },
    epoch: args.epoch,
  })
  return result.status === 'failed' ? failureOf(result) : null
}

const killShell = async (args: {
  session: DaemonSession
  shellId: string
  epoch?: number | undefined
}): Promise<ShellInfo> => {
  const result = await runToEnd({
    session: args.session,
    key: `kill-${args.shellId}`,
    op: { op: 'shells.kill', shellId: args.shellId },
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.kill' })
}

const listShells = async (args: {
  session: DaemonSession
  key: string
  epoch?: number | undefined
}): Promise<ShellInfo[]> => {
  const result = await runToEnd({
    session: args.session,
    key: args.key,
    op: { op: 'shells.list' },
    epoch: args.epoch,
  })
  return okValue({ result, op: 'shells.list' })
}

const untilEnded = (args: { session: DaemonSession; shellId: string }): Promise<unknown> =>
  args.session.until(
    (frame) =>
      frame.kind === 'event' &&
      frame.event.type === 'shells.ended' &&
      frame.event.shellId === args.shellId,
    { label: `shells.ended ${args.shellId}` },
  )

export const describeShellsConformance = (target: DaemonConformanceTarget): void => {
  describe(`shells conformance (${target.name})`, () => {
    it('launches a shell, publishes output events and reads at offsets with no gap', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const info = await launch({ session, key: 's-out', command: 'echo one; echo two' })
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
          await untilEnded({ session, shellId: 's-out' })

          const first = await readText({ session, shellId: 's-out', offset: 0 })
          expect(first.text).toBe('one\ntwo\n')
          expect(first.offset).toBe(0)
          expect(first.totalBytes).toBe(8)
          expect(first.info.status).toBe(EShellRunStatus.Exited)
          expect(first.info.exitCode).toBe(0)

          const middle = await readText({ session, shellId: 's-out', offset: 4 })
          expect(middle.text).toBe('two\n')
          const pastEnd = await readText({ session, shellId: 's-out', offset: 8 })
          expect(pastEnd.text).toBe('')
          expect(pastEnd.totalBytes).toBe(8)
        },
      }))

    it('writes to and ends the input of a cat shell', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await launch({ session, key: 's-cat', command: 'cat', input: true })
          expect(await writeShell({ session, shellId: 's-cat', data: 'hello\n' })).toBeNull()
          await session.until(
            (frame) =>
              frame.kind === 'event' &&
              frame.event.type === 'shells.output' &&
              frame.event.shellId === 's-cat',
            { label: 'shells.output s-cat' },
          )
          expect(await writeShell({ session, shellId: 's-cat', data: '', end: true })).toBeNull()
          await untilEnded({ session, shellId: 's-cat' })
          const chunk = await readText({ session, shellId: 's-cat', offset: 0 })
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
          await launch({ session, key: 's-noinput', command: 'sleep 30' })
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
          op: launchOp({ shellId: 's-tree', command: 'sleep 30 & echo $!; wait' }),
        })
        await replyOf({ session, key: 's-tree' })
        await session.until(
          (frame) =>
            frame.kind === 'event' &&
            frame.event.type === 'shells.output' &&
            frame.event.shellId === 's-tree',
          { label: 'shells.output s-tree' },
        )
        const chunk = await readText({ session, shellId: 's-tree', offset: 0 })
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
          await launch({ session, key: 's-timeout', command: 'sleep 30', timeoutMs: 200 })
          await untilEnded({ session, shellId: 's-timeout' })
          const chunk = await readShell({ session, shellId: 's-timeout', offset: 0 })
          expect(chunk.info.status).toBe(EShellRunStatus.TimedOut)
        },
      }))

    it('keeps a shell running across a reconnect and a takeover, and the new holder reads it', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const first = await connectAt({ handle, epoch: 5 })
          await launch({ session: first, key: 's-stay', command: 'sleep 30', epoch: 5 })
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
          await launch({ session, key: 's-dupe', command: 'echo ok' })
          sendRun({
            session,
            key: 'launch-dupe',
            op: launchOp({ shellId: 's-dupe', command: 'echo again' }),
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
          await launch({
            session,
            key: 's-limit',
            command: 'echo aaa; echo bbb',
            outputLimitBytes: 4,
          })
          await untilEnded({ session, shellId: 's-limit' })
          const chunk = await readText({ session, shellId: 's-limit', offset: 0 })
          expect(chunk.text).toBe('aaa\n')
          expect(chunk.totalBytes).toBe(8)
          const rest = await readText({ session, shellId: 's-limit', offset: 4 })
          expect(rest.text).toBe('')
          expect(rest.totalBytes).toBe(8)
        },
      }))
  })
}
