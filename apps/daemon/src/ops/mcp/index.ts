import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'
import {
  type DaemonGroup,
  type DaemonGroupFactory,
  type GroupContext,
  defineOp,
} from '@dltech/atlas-protocol/engine'

import { ManagedProcess } from '../../process/managed'
import type { DaemonOpsDeps } from '../deps'

const BUFFER_LINES = 10_000
const EVENT_LINE_BYTES = 1024 * 1024
const STDERR_LINES = 40
const STDERR_BYTES = 8 * 1024

type BufferedLine = { seq: number; line: string }
type Exit = { exitCode: number | null; signal: string | null }

type RunningServer = {
  serverId: string
  child: ManagedProcess
  lines: BufferedLine[]
  partial: string
  stderr: string[]
  stderrBytes: number
  stderrPartial: string
  seq: number
  ended: Exit | null
  closed: Promise<Exit>
}

const scrubEnv = (args: {
  base: Record<string, string | undefined>
  extra: Record<string, string> | undefined
}): Record<string, string> => ({
  ...(args.base['PATH'] !== undefined ? { PATH: args.base['PATH'] } : {}),
  ...(args.base['HOME'] !== undefined ? { HOME: args.base['HOME'] } : {}),
  ...(args.extra ?? {}),
})

const serverOf = (servers: Map<string, RunningServer>, serverId: string): RunningServer => {
  const server = servers.get(serverId)
  if (server === undefined) {
    throw new CallFailureError({
      code: ECallFailure.NotFound,
      message: `unknown mcp server '${serverId}'`,
    })
  }
  return server
}

export const mcpGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  (ctx: GroupContext): DaemonGroup => {
    const servers = new Map<string, RunningServer>()

    const record = (server: RunningServer, line: string): void => {
      server.seq += 1
      server.lines.push({ seq: server.seq, line })
      if (server.lines.length > BUFFER_LINES) server.lines.shift()
      if (line.length > EVENT_LINE_BYTES) {
        ctx.publish({ type: 'mcp.dropped', serverId: server.serverId, seq: server.seq })
        return
      }
      ctx.publish({ type: 'mcp.message', serverId: server.serverId, seq: server.seq, line })
    }

    const recordStderr = (server: RunningServer, line: string): void => {
      if (server.stderr.length >= STDERR_LINES) return
      if (server.stderrBytes + line.length + 1 > STDERR_BYTES) return
      server.stderr.push(line)
      server.stderrBytes += line.length + 1
    }

    const drainStderr = (server: RunningServer, bytes: Uint8Array): void => {
      const text = server.stderrPartial + new TextDecoder().decode(bytes)
      const parts = text.split('\n')
      server.stderrPartial = parts.pop() ?? ''
      for (const part of parts) recordStderr(server, part)
    }

    const drain = (server: RunningServer, bytes: Uint8Array): void => {
      const text = server.partial + new TextDecoder().decode(bytes)
      const parts = text.split('\n')
      server.partial = parts.pop() ?? ''
      for (const part of parts) record(server, part)
    }

    const close = async (server: RunningServer): Promise<Exit> => {
      server.child.closeInput()
      return await server.closed
    }

    const stopAll = async (): Promise<void> => {
      const running = [...servers.values()]
      servers.clear()
      for (const server of running) server.child.kill()
      await Promise.allSettled(running.map((server) => server.closed))
    }

    return {
      name: 'mcp',
      ops: [
        defineOp({
          op: 'mcp.spawn',
          run: async ({ op }) => {
            if (servers.has(op.serverId)) {
              throw new CallFailureError({
                code: ECallFailure.AlreadyExists,
                message: `an mcp server '${op.serverId}' is already running`,
              })
            }
            const holder: { current: RunningServer | null } = { current: null }
            const child = ManagedProcess.spawn({
              cmd: [op.command, ...(op.args ?? [])],
              cwd: op.cwd,
              env: scrubEnv({ base: deps.env, extra: op.env }),
              input: true,
              onStdout: (bytes) => {
                if (holder.current !== null) drain(holder.current, bytes)
              },
              onStderr: (bytes) => {
                if (holder.current !== null) drainStderr(holder.current, bytes)
              },
            })
            const server: RunningServer = {
              serverId: op.serverId,
              child,
              lines: [],
              partial: '',
              stderr: [],
              stderrBytes: 0,
              stderrPartial: '',
              seq: 0,
              ended: null,
              closed: child.exit().then((exit) => {
                if (server.stderrPartial !== '') recordStderr(server, server.stderrPartial)
                server.stderrPartial = ''
                const ended = { exitCode: exit.exitCode, signal: exit.signal }
                server.ended = ended
                ctx.publish({ type: 'mcp.exited', serverId: op.serverId, ...ended })
                return ended
              }),
            }
            holder.current = server
            servers.set(op.serverId, server)
            return { serverId: op.serverId, pid: child.pid }
          },
        }),
        defineOp({
          op: 'mcp.send',
          run: async ({ op }) => {
            if (op.line.includes('\n')) {
              throw new CallFailureError({
                code: ECallFailure.InvalidInput,
                message: 'an mcp.send line cannot contain a newline',
              })
            }
            const server = serverOf(servers, op.serverId)
            if (server.ended !== null) {
              throw new CallFailureError({
                code: ECallFailure.NotFound,
                message: `the mcp server '${op.serverId}' is not running`,
              })
            }
            const written = server.child.writeInput(new TextEncoder().encode(`${op.line}\n`))
            if (!written) {
              throw new CallFailureError({
                code: ECallFailure.Internal,
                message: `could not write to the mcp server '${op.serverId}'`,
              })
            }
            return null
          },
        }),
        defineOp({
          op: 'mcp.read',
          run: async ({ op }) => {
            const server = serverOf(servers, op.serverId)
            return {
              lines: server.lines.filter((entry) => entry.seq > op.afterSeq),
              stderr: server.stderr,
              ended: server.ended,
            }
          },
        }),
        defineOp({
          op: 'mcp.close',
          run: async ({ op }) => {
            const server = serverOf(servers, op.serverId)
            servers.delete(op.serverId)
            return await close(server)
          },
        }),
        defineOp({
          op: 'mcp.list',
          run: async () =>
            [...servers.values()].map((server) => ({
              serverId: server.serverId,
              pid: server.child.pid,
              running: server.ended === null,
            })),
        }),
      ],
      stop: stopAll,
    }
  }
