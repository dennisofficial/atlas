import { describe, expect, it } from 'bun:test'

import { ECallFailure } from '../../ops'
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

import { ECHO_SCRIPT, exitedEventOf, messageEventOf, sendLine, spawnEcho } from './mcp-support'

export const describeMcpConformance = (target: DaemonConformanceTarget): void => {
  describe(`mcp conformance (${target.name})`, () => {
    it('relays a sent line and publishes the echo as a message event with its id', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnEcho({ session, serverId: 'srv-echo' })
          const waiting = messageEventOf({ session, serverId: 'srv-echo' })
          await sendLine({
            session,
            serverId: 'srv-echo',
            line: '{"jsonrpc":"2.0","id":42,"method":"ping"}',
          })
          const event = await waiting
          const parsed = JSON.parse(event.line) as { id: number; result: { echo: string } }
          expect(parsed.id).toBe(42)
          expect(parsed.result.echo).toBe('{"jsonrpc":"2.0","id":42,"method":"ping"}')
          expect(event.seq).toBe(1)
        },
      }))

    it('returns missed lines by seq through mcp.read after a reconnect', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const first = await connectAt({ handle })
          await spawnEcho({ session: first, serverId: 'srv-resume' })
          await sendLine({
            session: first,
            serverId: 'srv-resume',
            line: '{"jsonrpc":"2.0","id":1,"method":"one"}',
          })
          await messageEventOf({ session: first, serverId: 'srv-resume' })
          await sendLine({
            session: first,
            serverId: 'srv-resume',
            line: '{"jsonrpc":"2.0","id":2,"method":"two"}',
          })
          first.close()
          const second = await connectAt({ handle })
          const result = await runToEnd({
            session: second,
            key: 'read-resume',
            op: { op: 'mcp.read', serverId: 'srv-resume', afterSeq: 1 },
          })
          const value = okValue({ result, op: 'mcp.read' })
          expect(value.ended).toBeNull()
          expect(value.lines.length).toBe(1)
          const only = value.lines[0]
          if (only === undefined) throw new Error('expected one missed line')
          expect(only.seq).toBe(2)
          const parsed = JSON.parse(only.line) as { id: number }
          expect(parsed.id).toBe(2)
        },
      }))

    it('closes the server on mcp.close, reports the exit, and publishes mcp.exited', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnEcho({ session, serverId: 'srv-close' })
          const waiting = exitedEventOf({ session, serverId: 'srv-close' })
          const result = await runToEnd({
            session,
            key: 'close-srv-close',
            op: { op: 'mcp.close', serverId: 'srv-close' },
          })
          const exit = okValue({ result, op: 'mcp.close' })
          expect(exit).toEqual({ exitCode: 0, signal: null })
          const event = await waiting
          expect(event).toEqual(exit)
          const after = await runToEnd({
            session,
            key: 'list-after-close',
            op: { op: 'mcp.list' },
          })
          expect(okValue({ result: after, op: 'mcp.list' })).toEqual([])
        },
      }))

    it('rejects a line containing a newline with invalid-input', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnEcho({ session, serverId: 'srv-newline' })
          const result = await runToEnd({
            session,
            key: 'send-newline',
            op: { op: 'mcp.send', serverId: 'srv-newline', line: '{"id":1}\n{"id":2}' },
          })
          expect(failureOf(result)).toBe(ECallFailure.InvalidInput)
        },
      }))

    it('fails unknown server ids with not-found', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const send = await runToEnd({
            session,
            key: 'send-unknown',
            op: { op: 'mcp.send', serverId: 'srv-unknown', line: '{"id":1}' },
          })
          expect(failureOf(send)).toBe(ECallFailure.NotFound)
          const read = await runToEnd({
            session,
            key: 'read-unknown',
            op: { op: 'mcp.read', serverId: 'srv-unknown', afterSeq: 0 },
          })
          expect(failureOf(read)).toBe(ECallFailure.NotFound)
          const close = await runToEnd({
            session,
            key: 'close-unknown',
            op: { op: 'mcp.close', serverId: 'srv-unknown' },
          })
          expect(failureOf(close)).toBe(ECallFailure.NotFound)
        },
      }))

    it('fails a duplicate server id with already-exists', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          await spawnEcho({ session, serverId: 'srv-dup' })
          const duplicate = await runToEnd({
            session,
            key: 'spawn-dup-again',
            op: { op: 'mcp.spawn', serverId: 'srv-dup', command: 'bun', args: ['-e', ECHO_SCRIPT] },
          })
          expect(failureOf(duplicate)).toBe(ECallFailure.AlreadyExists)
        },
      }))

    it('lists running servers with their pid', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const spawned = await spawnEcho({ session, serverId: 'srv-list' })
          const result = await runToEnd({
            session,
            key: 'list-running',
            op: { op: 'mcp.list' },
          })
          expect(okValue({ result, op: 'mcp.list' })).toEqual([{ ...spawned, running: true }])
        },
      }))

    it('scrubs the environment to PATH and HOME plus the spec env (real only)', async () => {
      const handle = await target.start()
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        await spawnEcho({
          session,
          serverId: 'srv-env',
          env: { SPEC_MARKER: 'from-spec' },
          script:
            'console.log(JSON.stringify({ secret: process.env.DAEMON_SECRET ?? "absent", randomParent: process.env.RANDOM_PARENT_VAR ?? "absent", marker: process.env.SPEC_MARKER ?? "absent" })); for await (const _ of Bun.stdin.stream()) {}',
        })
        const event = await messageEventOf({ session, serverId: 'srv-env' })
        const parsed = JSON.parse(event.line) as {
          secret: string
          randomParent: string
          marker: string
        }
        expect(parsed.secret).toBe('absent')
        expect(parsed.randomParent).toBe('absent')
        expect(parsed.marker).toBe('from-spec')
      } finally {
        await handle.stop()
      }
    })

    it('kills the process when the daemon stops (real only)', async () => {
      const handle = await target.start()
      let pid = 0
      try {
        if (!handle.realProcesses) return
        const session = await connectAt({ handle })
        const spawned = await spawnEcho({ session, serverId: 'srv-die' })
        pid = spawned.pid
        expect(handle.processAlive(pid)).toBe(true)
      } finally {
        await handle.stop()
      }
      await sleep(200)
      expect(handle.processAlive(pid)).toBe(false)
    })

    it('keeps send and read ordering across an epoch takeover', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const first = await connectAt({ handle })
          await spawnEcho({ session: first, serverId: 'srv-takeover' })
          const second = await connectAt({ handle, epoch: EPOCH + 1 })
          sendRun({
            session: second,
            key: 'send-takeover',
            epoch: EPOCH + 1,
            op: { op: 'mcp.send', serverId: 'srv-takeover', line: '{"jsonrpc":"2.0","id":7}' },
          })
          await replyOf({ session: second, key: 'send-takeover' })
          const result = await resultOf({ session: second, key: 'send-takeover' })
          okValue({ result, op: 'mcp.send' })
          const event = await messageEventOf({ session: second, serverId: 'srv-takeover' })
          const parsed = JSON.parse(event.line) as { id: number }
          expect(parsed.id).toBe(7)
        },
      }))
  })
}
