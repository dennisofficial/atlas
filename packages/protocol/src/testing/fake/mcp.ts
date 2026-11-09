import {
  type DaemonGroup,
  type DaemonGroupFactory,
  type GroupContext,
  defineOp,
} from '../../engine'
import { CallFailureError, ECallFailure } from '../../ops'

const EVENT_LINE_BYTES = 1024 * 1024

type BufferedLine = { seq: number; line: string }
type Exit = { exitCode: number; signal: string | null }

type FakeServer = {
  serverId: string
  pid: number
  lines: BufferedLine[]
  stderr: string[]
  seq: number
  ended: Exit | null
  closed: Promise<Exit>
  respond(line: string): void
  close(): void
}

const echoOf = (line: string): string => {
  try {
    const message = JSON.parse(line) as { id?: unknown }
    const id = typeof message.id === 'number' || typeof message.id === 'string' ? message.id : null
    return JSON.stringify({ jsonrpc: '2.0', id, result: { echo: line } })
  } catch {
    return line
  }
}

const serverOf = (servers: Map<string, FakeServer>, serverId: string): FakeServer => {
  const server = servers.get(serverId)
  if (server === undefined) {
    throw new CallFailureError({
      code: ECallFailure.NotFound,
      message: `unknown mcp server '${serverId}'`,
    })
  }
  return server
}

export const fakeMcpGroup = (): DaemonGroupFactory => {
  let nextPid = 1000
  return (ctx: GroupContext): DaemonGroup => {
    const servers = new Map<string, FakeServer>()

    const spawn = (serverId: string): FakeServer => {
      let settleClosed: (exit: Exit) => void = () => {}
      const server: FakeServer = {
        serverId,
        pid: nextPid++,
        lines: [],
        stderr: [],
        seq: 0,
        ended: null,
        closed: new Promise<Exit>((resolve) => {
          settleClosed = resolve
        }),
        respond(line) {
          server.seq += 1
          server.lines.push({ seq: server.seq, line })
          if (line.length > EVENT_LINE_BYTES) {
            ctx.publish({ type: 'mcp.dropped', serverId, seq: server.seq })
            return
          }
          ctx.publish({ type: 'mcp.message', serverId, seq: server.seq, line })
        },
        close() {
          if (server.ended !== null) return
          const exit = { exitCode: 0, signal: null }
          server.ended = exit
          settleClosed(exit)
          ctx.publish({ type: 'mcp.exited', serverId, ...exit })
        },
      }
      return server
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
            const server = spawn(op.serverId)
            servers.set(op.serverId, server)
            return { serverId: op.serverId, pid: server.pid }
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
            server.respond(echoOf(op.line))
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
            server.close()
            return await server.closed
          },
        }),
        defineOp({
          op: 'mcp.list',
          run: async () =>
            [...servers.values()].map((server) => ({
              serverId: server.serverId,
              pid: server.pid,
              running: server.ended === null,
            })),
        }),
      ],
      stop: async () => {
        const running = [...servers.values()]
        servers.clear()
        for (const server of running) server.close()
        await Promise.allSettled(running.map((server) => server.closed))
      },
    }
  }
}
