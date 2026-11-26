import type { OpValue } from '../../ops'
import type { DaemonSession } from '../client'
import { FAKE_MCP_SILENT } from '../fake/mcp'
import { okValue, runToEnd } from './support'

export const ECHO_SCRIPT = [
  'const reader = Bun.stdin.stream().getReader()',
  'const decoder = new TextDecoder()',
  'let buffer = ""',
  'for (;;) {',
  '  const { done, value } = await reader.read()',
  '  if (done) break',
  '  buffer += decoder.decode(value, { stream: true })',
  '  let index',
  '  while ((index = buffer.indexOf("\\n")) !== -1) {',
  '    const line = buffer.slice(0, index)',
  '    buffer = buffer.slice(index + 1)',
  '    if (line === "") continue',
  '    let id = null',
  '    try { id = JSON.parse(line).id ?? null } catch {}',
  '    console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { echo: line } }))',
  '  }',
  '}',
].join('; ')

export const SILENT_SCRIPT = 'for await (const _ of Bun.stdin.stream()) {}'

export const spawnSilent = (args: {
  session: DaemonSession
  serverId: string
}): Promise<{ serverId: string; pid: number; attached: boolean; seq: number }> =>
  spawnEcho({
    ...args,
    script: SILENT_SCRIPT,
    env: { [FAKE_MCP_SILENT]: '1' },
  })

export const spawnEcho = (args: {
  session: DaemonSession
  serverId: string
  command?: string
  script?: string
  env?: Record<string, string>
  specHash?: string
}): Promise<{ serverId: string; pid: number; attached: boolean; seq: number }> =>
  runToEnd({
    session: args.session,
    key: `spawn-${args.serverId}`,
    op: {
      op: 'mcp.spawn',
      serverId: args.serverId,
      command: args.command ?? 'bun',
      args: args.command === undefined ? ['-e', args.script ?? ECHO_SCRIPT] : [],
      ...(args.env === undefined ? {} : { env: args.env }),
      ...(args.specHash === undefined ? {} : { specHash: args.specHash }),
    },
  }).then((result) => okValue({ result, op: 'mcp.spawn' }))

export const sendLine = (args: {
  session: DaemonSession
  serverId: string
  line: string
  key?: string
}): Promise<unknown> =>
  runToEnd({
    session: args.session,
    key: args.key ?? `send-${args.serverId}-${Math.random().toString(36).slice(2)}`,
    op: { op: 'mcp.send', serverId: args.serverId, line: args.line },
  }).then((result) => okValue({ result, op: 'mcp.send' }))

export const requestOf = (args: {
  session: DaemonSession
  serverId: string
  key: string
  method: string
  params?: unknown
  timeoutMs?: number
}): Promise<OpValue<'mcp.request'>> =>
  runToEnd({
    session: args.session,
    key: args.key,
    op: {
      op: 'mcp.request',
      serverId: args.serverId,
      method: args.method,
      ...(args.params === undefined ? {} : { params: args.params }),
      timeoutMs: args.timeoutMs ?? 5_000,
    },
  }).then((result) => okValue({ result, op: 'mcp.request' }))

export const readLines = (args: {
  session: DaemonSession
  serverId: string
  afterSeq?: number
}): Promise<readonly { seq: number; line: string }[]> =>
  runToEnd({
    session: args.session,
    key: `read-${args.serverId}-${Math.random().toString(36).slice(2)}`,
    op: { op: 'mcp.read', serverId: args.serverId, afterSeq: args.afterSeq ?? 0 },
  }).then((result) => okValue({ result, op: 'mcp.read' }).lines)

export const messageEventOf = (args: {
  session: DaemonSession
  serverId: string
}): Promise<{ seq: number; line: string }> =>
  args.session
    .until(
      (frame) =>
        frame.kind === 'event' &&
        frame.event.type === 'mcp.message' &&
        frame.event.serverId === args.serverId,
      { label: `mcp.message ${args.serverId}` },
    )
    .then((frame) => {
      if (frame.kind !== 'event' || frame.event.type !== 'mcp.message') {
        throw new Error('unreachable')
      }
      return frame.event
    })

export const exitedEventOf = (args: {
  session: DaemonSession
  serverId: string
}): Promise<{ exitCode: number | null; signal: string | null }> =>
  args.session
    .until(
      (frame) =>
        frame.kind === 'event' &&
        frame.event.type === 'mcp.exited' &&
        frame.event.serverId === args.serverId,
      { label: `mcp.exited ${args.serverId}` },
    )
    .then((frame) => {
      if (frame.kind !== 'event' || frame.event.type !== 'mcp.exited') {
        throw new Error('unreachable')
      }
      return { exitCode: frame.event.exitCode, signal: frame.event.signal }
    })
