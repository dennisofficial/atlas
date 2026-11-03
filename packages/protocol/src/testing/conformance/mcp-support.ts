import type { DaemonSession } from '../client'
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

export const spawnEcho = (args: {
  session: DaemonSession
  serverId: string
  command?: string
  script?: string
  env?: Record<string, string>
}): Promise<{ serverId: string; pid: number }> =>
  runToEnd({
    session: args.session,
    key: `spawn-${args.serverId}`,
    op: {
      op: 'mcp.spawn',
      serverId: args.serverId,
      command: args.command ?? 'bun',
      args: args.command === undefined ? ['-e', args.script ?? ECHO_SCRIPT] : [],
      ...(args.env === undefined ? {} : { env: args.env }),
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
