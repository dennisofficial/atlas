import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import type { OperatorInputPort, OperatorInputRequestArgs } from '../../../operator-input/port'
import { OperatorInputTool } from '../operator-input'

const THREAD = toThreadId('thread-operator-input-tool')
const invoke = (args: { tool: OperatorInputTool; input: unknown; signal?: AbortSignal }) => args.tool.invoke({
  input: args.input, signal: args.signal ?? new AbortController().signal,
  idempotencyKey: 'opinput-1', projectDirectory: '/tmp', threadId: THREAD,
})

function fixture() {
  const requests: OperatorInputRequestArgs[] = []
  const port: OperatorInputPort = {
    request: async (args) => { requests.push(args); return { ok: true, bytes: 12345 } },
    answer: async () => ({ ok: true, bytes: 12345 }),
    pending: () => null,
  }
  const threads = { find: async () => ({
    id: THREAD, head: 1, workspace: '/tmp', repo: null,
    createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
  }) }
  return { port, tool: new OperatorInputTool({ operatorInput: port, threads }), requests }
}

describe('operator_input', () => {
  it('returns only the delivery metadata, never the pasted content', async () => {
    const { tool, requests } = fixture()
    const signal = new AbortController().signal
    const result = await invoke({ tool, signal, input: {
      description: 'paste the login code', path: '/tmp/new-code', url: 'https://example.com', appendNewline: true,
    } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.output).toMatchObject({ path: '/tmp/new-code', bytes: 12345 })
    expect(result.modelText).toContain('12345 bytes')
    expect(requests[0]).toMatchObject({ threadId: THREAD, cwd: '/tmp', appendNewline: true, signal })
  })

  it('defaults to exact text without appending a newline', async () => {
    const { tool, requests } = fixture()
    await invoke({ tool, input: { description: 'paste text', path: '/tmp/new-code' } })
    expect(requests[0]?.appendNewline).toBe(false)
  })

  it('propagates a failed delivery or cancelled request', async () => {
    const { tool, port } = fixture()
    port.request = async () => ({ ok: false, reason: 'no reader' })
    expect(await invoke({ tool, input: { description: 'x', path: '/tmp/whatever' } })).toEqual({ ok: false, reason: 'no reader' })
  })

  it('refuses child-thread requests instead of opening an unreachable card', async () => {
    const { port, requests } = fixture()
    const tool = new OperatorInputTool({
      operatorInput: port,
      threads: { find: async () => ({
        id: THREAD, head: 1, workspace: '/tmp', repo: null,
        createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
        agent: { spawnedBy: toThreadId('parent'), type: 'explore' },
      }) },
    })
    expect(await invoke({ tool, input: { description: 'x', path: '/tmp/whatever' } })).toMatchObject({ ok: false })
    expect(requests).toHaveLength(0)
  })

  it('refuses unverifiable and unknown threads without publishing a card', async () => {
    const { port, requests } = fixture()
    const unknown = new OperatorInputTool({ operatorInput: port, threads: { find: async () => undefined } })
    const failed = new OperatorInputTool({ operatorInput: port, threads: { find: async () => { throw new Error('unreadable') } } })
    const input = { description: 'x', path: '/tmp/x' }
    expect((await invoke({ tool: unknown, input })).ok).toBe(false)
    expect((await invoke({ tool: failed, input })).ok).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('rejects malformed input before asking the operator', async () => {
    const { tool, requests } = fixture()
    expect((await invoke({ tool, input: { path: '' } })).ok).toBe(false)
    expect((await invoke({ tool, input: { description: 'x', path: '/tmp/x', url: 'javascript:alert(1)' } })).ok).toBe(false)
    expect(requests).toHaveLength(0)
  })
})
