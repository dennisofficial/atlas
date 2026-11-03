import { describe, expect, it } from 'bun:test'

import { ECallFailure, type CallOp } from '../../ops'
import type { DaemonSession } from '../client'
import {
  EPOCH,
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

let keys = 0
const run = (args: { session: DaemonSession; op: CallOp; epoch?: number | undefined }) => {
  keys += 1
  return runToEnd({
    session: args.session,
    key: `t-${keys}`,
    op: args.op,
    ...(args.epoch === undefined ? {} : { epoch: args.epoch }),
  })
}

const open = (args: { session: DaemonSession; terminalId: string }) =>
  run({
    session: args.session,
    op: { op: 'terminal.open', terminalId: args.terminalId, cols: 80, rows: 24 },
  })

const write = (args: { session: DaemonSession; terminalId: string; data: string }) =>
  run({
    session: args.session,
    op: { op: 'terminal.write', terminalId: args.terminalId, data: args.data },
  })

const close = (args: { session: DaemonSession; terminalId: string }) =>
  run({ session: args.session, op: { op: 'terminal.close', terminalId: args.terminalId } })

const read = (args: {
  session: DaemonSession
  terminalId: string
  offset: number
  epoch?: number | undefined
}) =>
  run({
    session: args.session,
    op: { op: 'terminal.read', terminalId: args.terminalId, offset: args.offset },
    ...(args.epoch === undefined ? {} : { epoch: args.epoch }),
  })

const outputEvents = (args: { session: DaemonSession; terminalId: string }): string =>
  Buffer.concat(
    args.session
      .frames()
      .filter(
        (frame) =>
          frame.kind === 'event' &&
          frame.event.type === 'terminal.output' &&
          frame.event.terminalId === args.terminalId,
      )
      .map((frame) => {
        if (frame.kind !== 'event' || frame.event.type !== 'terminal.output') {
          throw new Error('unreachable')
        }
        return Buffer.from(frame.event.data, 'base64')
      }),
  ).toString('utf8')

const untilOutput = (args: {
  session: DaemonSession
  terminalId: string
  needle: string
}): Promise<void> =>
  args.session
    .until(
      (frame) => {
        if (frame.kind !== 'event' || frame.event.type !== 'terminal.output') return false
        if (frame.event.terminalId !== args.terminalId) return false
        const text = Buffer.from(frame.event.data, 'base64').toString('utf8')
        return text.includes(args.needle) || outputEvents(args).includes(args.needle)
      },
      { label: `terminal.output ${args.needle}` },
    )
    .then(() => undefined)

export const describeTerminalConformance = (target: DaemonConformanceTarget): void => {
  describe(`terminal conformance (${target.name})`, () => {
    it('opens a terminal, echoes a written command, and reports a pid', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const opened = okValue({
            result: await open({ session, terminalId: 't-one' }),
            op: 'terminal.open',
          })
          expect(opened.terminalId).toBe('t-one')
          expect(opened.pid).toBeGreaterThan(0)
          await write({ session, terminalId: 't-one', data: 'echo hi\n' })
          await untilOutput({ session, terminalId: 't-one', needle: 'hi' })
          expect(outputEvents({ session, terminalId: 't-one' })).toContain('hi')
        },
      }))

    it('refuses a ninth open terminal', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          for (let i = 0; i < 8; i++) {
            await open({ session, terminalId: `t-nine-${i}` })
          }
          expect(failureOf(await open({ session, terminalId: 't-nine-last' }))).toBe(
            ECallFailure.InvalidInput,
          )
        },
      }))

    it('resizes so stty size reports the new geometry (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        await open({ session, terminalId: 't-size' })
        await run({
          session,
          op: { op: 'terminal.resize', terminalId: 't-size', cols: 132, rows: 43 },
        })
        await write({ session, terminalId: 't-size', data: 'stty size\n' })
        await untilOutput({ session, terminalId: 't-size', needle: '43 132' })
      } finally {
        await handle.stop()
      }
    })

    it('kills a SIGHUP-immune descendant of the shell on close (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        await open({ session, terminalId: 't-tree' })
        // `exec` makes the subshell the PTY child itself, so the nohup'd sleep shares its
        // process group; only a group signal (or the cgroup box) can reach it.
        await write({
          session,
          terminalId: 't-tree',
          data: "exec sh -c 'nohup sleep 300 >/dev/null 2>&1 & echo BG=$!; sleep 300'\n",
        })
        await session.until(() => /BG=\d+/.test(outputEvents({ session, terminalId: 't-tree' })), {
          label: 'BG= pid',
        })
        const match = /BG=(\d+)/.exec(outputEvents({ session, terminalId: 't-tree' }))
        const pid = Number(match?.[1])
        expect(handle.processAlive(pid)).toBe(true)
        await close({ session, terminalId: 't-tree' })
        await sleep(3000)
        expect(handle.processAlive(pid)).toBe(false)
      } finally {
        await handle.stop()
      }
    })

    it('closes a terminal, emits the exit event, and returns the exit', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await open({ session, terminalId: 't-close' })
          sendRun({
            session,
            key: 't-close-call',
            op: { op: 'terminal.close', terminalId: 't-close' },
          })
          await replyOf({ session, key: 't-close-call' })
          const result = await resultOf({ session, key: 't-close-call' })
          const exit = okValue({ result, op: 'terminal.close' })
          expect(exit.exitCode !== null || exit.signal !== null).toBe(true)
          const event = session
            .frames()
            .find(
              (frame) =>
                frame.kind === 'event' &&
                frame.event.type === 'terminal.exit' &&
                frame.event.terminalId === 't-close',
            )
          expect(event).toBeDefined()
          expect(failureOf(await write({ session, terminalId: 't-close', data: 'x' }))).toBe(
            ECallFailure.NotFound,
          )
        },
      }))

    it('survives a disconnect and replays scrollback to a new holder', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const first = await connectAt({ handle })
          await open({ session: first, terminalId: 't-keep' })
          await write({ session: first, terminalId: 't-keep', data: 'echo keepme\n' })
          await untilOutput({ session: first, terminalId: 't-keep', needle: 'keepme' })
          first.close()
          const second = await connectAt({ handle, epoch: EPOCH + 1 })
          const replay = okValue({
            result: await read({
              session: second,
              terminalId: 't-keep',
              offset: 0,
              epoch: EPOCH + 1,
            }),
            op: 'terminal.read',
          })
          expect(replay.exited).toBeNull()
          expect(replay.offset).toBe(0)
          expect(replay.totalBytes).toBeGreaterThan(0)
          expect(Buffer.from(replay.data, 'base64').toString('utf8')).toContain('keepme')
        },
      }))

    it('reads an exited terminal as scrollback plus its exit', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await open({ session, terminalId: 't-dead' })
          await write({ session, terminalId: 't-dead', data: 'echo bye\n' })
          await untilOutput({ session, terminalId: 't-dead', needle: 'bye' })
          const exit = okValue({
            result: await close({ session, terminalId: 't-dead' }),
            op: 'terminal.close',
          })
          const replay = okValue({
            result: await read({ session, terminalId: 't-dead', offset: 0 }),
            op: 'terminal.read',
          })
          expect(replay.exited).toEqual(exit)
          expect(Buffer.from(replay.data, 'base64').toString('utf8')).toContain('bye')
          expect(failureOf(await write({ session, terminalId: 't-dead', data: 'x' }))).toBe(
            ECallFailure.NotFound,
          )
        },
      }))

    it('hides V2_DAEMON_SECRET from the terminal environment (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        await open({ session, terminalId: 't-env' })
        await write({
          session,
          terminalId: 't-env',
          data: 'if [ -n "$V2_DAEMON_SECRET" ]; then echo SECRET_LEAKED; else echo SECRET_ABSENT; fi\n',
        })
        await untilOutput({ session, terminalId: 't-env', needle: 'SECRET_ABSENT' })
      } finally {
        await handle.stop()
      }
    })

    it('refuses a duplicate id and unknown ids as not-found', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await open({ session, terminalId: 't-dup' })
          expect(failureOf(await open({ session, terminalId: 't-dup' }))).toBe(
            ECallFailure.AlreadyExists,
          )
          expect(failureOf(await write({ session, terminalId: 't-nope', data: 'x' }))).toBe(
            ECallFailure.NotFound,
          )
          expect(
            failureOf(
              await run({
                session,
                op: { op: 'terminal.resize', terminalId: 't-nope', cols: 80, rows: 24 },
              }),
            ),
          ).toBe(ECallFailure.NotFound)
          expect(failureOf(await close({ session, terminalId: 't-nope' }))).toBe(
            ECallFailure.NotFound,
          )
          expect(failureOf(await read({ session, terminalId: 't-nope', offset: 0 }))).toBe(
            ECallFailure.NotFound,
          )
        },
      }))
  })
}
