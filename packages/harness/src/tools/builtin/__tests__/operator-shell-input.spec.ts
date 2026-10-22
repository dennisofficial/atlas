import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import type { OperatorInputPort, OperatorInputRequestArgs } from '../../../operator-input/port'
import { OperatorShellInputTool } from '../operator-shell-input'

const THREAD = toThreadId('thread-operator-shell-input-tool')
const invoke = (args: { tool: OperatorShellInputTool; input: unknown; signal?: AbortSignal }) => args.tool.invoke({
  input: args.input, signal: args.signal ?? new AbortController().signal,
  idempotencyKey: 'opshell-1', projectDirectory: '/tmp', threadId: THREAD,
})
const thread = {
  id: THREAD, head: 1, workspace: '/tmp', repo: null,
  createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
}

function fixture() {
  const requests: OperatorInputRequestArgs[] = []
  const port: OperatorInputPort = {
    request: async (args) => { requests.push(args); return { ok: true, bytes: 9 } },
    answer: async () => ({ ok: true, bytes: 9 }),
    pending: () => null,
  }
  return { port, requests, tool: new OperatorShellInputTool({ operatorInput: port, threads: { find: async () => thread } }) }
}

describe('operator_shell_input', () => {
  it('targets the shell, defaults to a newline, and returns only metadata', async () => {
    const { tool, requests } = fixture()
    const signal = new AbortController().signal
    const result = await invoke({ tool, signal, input: {
      description: 'paste the login code', shellId: 'sh-7', url: 'https://example.com/login',
    } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.output).toMatchObject({ shellId: 'sh-7', bytes: 9 })
    expect(result.modelText).toContain('sh-7')
    expect(result.modelText).toContain('9 bytes')
    expect(requests[0]).toMatchObject({
      threadId: THREAD, shellId: 'sh-7', url: 'https://example.com/login', cwd: '/tmp', appendNewline: true, signal,
    })
  })

  it('lets the caller turn the newline off', async () => {
    const { tool, requests } = fixture()
    await invoke({ tool, input: { description: 'paste', shellId: 'sh-7', appendNewline: false } })
    expect(requests[0]?.appendNewline).toBe(false)
  })

  it('teaches the login flow in its description', () => {
    const { tool } = fixture()
    expect(tool.description).toContain('runInBackground')
    expect(tool.description).toContain('shellId')
    expect(tool.description).toContain('does not enter the chat')
  })

  it('rejects unknown fields and a missing shellId', async () => {
    const { tool, requests } = fixture()
    expect((await invoke({ tool, input: { description: 'x', shellId: 'sh-7', path: '/tmp/x' } })).ok).toBe(false)
    expect((await invoke({ tool, input: { description: 'x' } })).ok).toBe(false)
    expect((await invoke({ tool, input: { description: 'x', shellId: 'sh-7', url: 'ftp://nope' } })).ok).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('propagates a failed delivery', async () => {
    const { tool, port } = fixture()
    port.request = async () => ({ ok: false, reason: 'stdin is closed' })
    expect(await invoke({ tool, input: { description: 'x', shellId: 'sh-7' } })).toEqual({ ok: false, reason: 'stdin is closed' })
  })

  it('refuses child-thread, unknown-thread and unreadable-thread callers', async () => {
    const { port, requests } = fixture()
    const input = { description: 'x', shellId: 'sh-7' }
    const child = new OperatorShellInputTool({ operatorInput: port, threads: { find: async () => ({ ...thread, agent: { spawnedBy: toThreadId('parent'), type: 'explore' } }) } })
    const unknown = new OperatorShellInputTool({ operatorInput: port, threads: { find: async () => undefined } })
    const failed = new OperatorShellInputTool({ operatorInput: port, threads: { find: async () => { throw new Error('unreadable') } } })
    for (const tool of [child, unknown, failed]) expect((await invoke({ tool, input })).ok).toBe(false)
    expect(requests).toHaveLength(0)
  })
})
