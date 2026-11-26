import { CallFailureError, ECallFailure } from '@dltech/atlas-protocol'
import { describe, expect, it } from 'bun:test'

import { mcpRig, waitUntil } from './rig'

const serverId = 'ses_1.docs'

const ECHO = [
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
  '    const message = JSON.parse(line)',
  '    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echo: line } }))',
  '  }',
  '}',
].join('\n')

const RECORDER = [
  'const reader = Bun.stdin.stream().getReader()',
  'const decoder = new TextDecoder()',
  'for (;;) {',
  '  const { done, value } = await reader.read()',
  '  if (done) break',
  '  for (const line of decoder.decode(value, { stream: true }).split("\\n")) {',
  '    if (line.includes("notifications/cancelled")) console.log(line)',
  '  }',
  '}',
].join('\n')

const DIES = [
  '(async () => {',
  '  for await (const line of Bun.stdin.stream()) {',
  '    if (line.length === 0) continue',
  '    process.stderr.write("fatal: no answer\\n")',
  '    await Bun.sleep(50)',
  '    process.exit(3)',
  '  }',
  '})()',
].join('\n')

const BIG = [
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
  '    const message = JSON.parse(line)',
  '    const pad = "x".repeat(2 * 1024 * 1024)',
  '    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { pad } }))',
  '  }',
  '}',
].join('\n')

const spawn = (daemon: ReturnType<typeof mcpRig>, script: string): Promise<unknown> =>
  daemon.call({ op: 'mcp.spawn', serverId, command: 'bun', args: ['-e', script], specHash: 'h1' })

const cancelledOf = (daemon: ReturnType<typeof mcpRig>): unknown =>
  daemon.lines(serverId).find((line) => line.includes('notifications/cancelled'))

describe('mcp.request', () => {
  it('answers by the call key and still publishes the line', async () => {
    const daemon = mcpRig()
    try {
      await spawn(daemon, ECHO)
      const result = await daemon.call(
        {
          op: 'mcp.request',
          serverId,
          method: 'tools/call',
          params: { name: 'count' },
          timeoutMs: 5_000,
        },
        { key: 'req-1' },
      )

      expect(result).toMatchObject({ kind: 'response', response: { id: 'req-1' } })
      const line = daemon.lines(serverId)[0]
      if (line === undefined) throw new Error('expected the answer line to be buffered')
      const response = JSON.parse(line) as { result: { echo: string } }
      expect(JSON.parse(response.result.echo)).toEqual({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'tools/call',
        params: { name: 'count' },
      })
    } finally {
      await daemon.stop()
    }
  })

  it('settles a request the server answers over the event line limit', async () => {
    const daemon = mcpRig()
    try {
      await spawn(daemon, BIG)
      const result = await daemon.call(
        { op: 'mcp.request', serverId, method: 'tools/call', timeoutMs: 5_000 },
        { key: 'req-big' },
      )

      expect(result).toMatchObject({ kind: 'response', response: { id: 'req-big' } })
      const dropped = daemon.events.filter((event) => event.type === 'mcp.dropped')
      expect(dropped).toHaveLength(1)
    } finally {
      await daemon.stop()
    }
  })

  it('resolves the request as exited with the stderr of the server', async () => {
    const daemon = mcpRig()
    try {
      await spawn(daemon, DIES)
      const result = await daemon.call(
        { op: 'mcp.request', serverId, method: 'tools/call', timeoutMs: 5_000 },
        { key: 'req-exit' },
      )

      expect(result).toEqual({
        kind: 'exited',
        exit: { exitCode: 3, signal: null },
        stderr: ['fatal: no answer'],
      })
    } finally {
      await daemon.stop()
    }
  })

  it('times out and tells the server the request was cancelled', async () => {
    const daemon = mcpRig()
    try {
      await spawn(daemon, RECORDER)
      const result = await daemon.call(
        { op: 'mcp.request', serverId, method: 'tools/call', timeoutMs: 50 },
        { key: 'req-timeout' },
      )

      expect(result).toEqual({ kind: 'timed-out' })
      await waitUntil(() => cancelledOf(daemon) !== undefined)
      const cancel = JSON.parse(String(cancelledOf(daemon))) as { params: unknown }
      expect(cancel.params).toEqual({ requestId: 'req-timeout', reason: 'timed out' })
    } finally {
      await daemon.stop()
    }
  })

  it('drops the waiter and cancels the request when the call is aborted', async () => {
    const daemon = mcpRig()
    try {
      await spawn(daemon, RECORDER)
      const controller = new AbortController()
      const pending = daemon.call(
        { op: 'mcp.request', serverId, method: 'tools/call', timeoutMs: 5_000 },
        { key: 'req-cancel', signal: controller.signal },
      )
      controller.abort()
      const failure = await pending.catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(CallFailureError)
      expect((failure as CallFailureError).failure.code).toBe(ECallFailure.Cancelled)
      await waitUntil(() => cancelledOf(daemon) !== undefined)
      const cancel = JSON.parse(String(cancelledOf(daemon))) as { params: unknown }
      expect(cancel.params).toEqual({ requestId: 'req-cancel', reason: 'cancelled' })
    } finally {
      await daemon.stop()
    }
  })

  it('fails an unknown server with not-found', async () => {
    const daemon = mcpRig()
    try {
      const failure = await daemon
        .call({
          op: 'mcp.request',
          serverId: 'ses_1.missing',
          method: 'tools/list',
          timeoutMs: 1_000,
        })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(CallFailureError)
      expect((failure as CallFailureError).failure.code).toBe(ECallFailure.NotFound)
    } finally {
      await daemon.stop()
    }
  })
})
