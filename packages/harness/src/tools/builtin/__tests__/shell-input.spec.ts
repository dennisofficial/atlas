import { describe, expect, it } from 'bun:test'
import { EToolEffect, toThreadId } from '@dltech/atlas-core'

import { ShellInputTool } from '../shell-input'

const THREAD = toThreadId('thread-input')
const invoke = (args: { tool: ShellInputTool; input: unknown }) => args.tool.invoke({
  input: args.input,
  signal: new AbortController().signal,
  idempotencyKey: 'input-1',
  projectDirectory: '/tmp',
  threadId: THREAD,
})

describe('shell_input', () => {
  it('routes input and EOF to the caller’s owned shell without inventing output', async () => {
    const sent: unknown[] = []
    const tool = new ShellInputTool({ writeInput: async (args) => { sent.push(args); return { ok: true } } })
    const result = await invoke({ tool, input: { shellId: 'bash_input', text: 'yes\n', end: true } })
    expect(sent).toEqual([{ shellId: 'bash_input', text: 'yes\n', end: true, threadId: THREAD }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.output).toEqual({ shellId: 'bash_input', bytes: 4, ended: true })
    expect(result.modelText).toContain('closed its stdin')
    expect(tool.effect).toBe(EToolEffect.Destructive)
  })

  it('reports a refused input instead of saying it was sent', async () => {
    const tool = new ShellInputTool({ writeInput: async () => ({ ok: false, reason: 'not your shell' }) })
    expect(await invoke({ tool, input: { shellId: 'bash_foreign', text: 'yes\n' } })).toMatchObject({
      ok: false, reason: 'not your shell',
    })
  })

  it('counts UTF-8 bytes and permits EOF without text', async () => {
    const tool = new ShellInputTool({ writeInput: async () => ({ ok: true }) })
    const unicode = await invoke({ tool, input: { shellId: 'bash_unicode', text: '🌍\n' } })
    expect(unicode.ok && unicode.output).toMatchObject({ bytes: 5 })
    const eof = await invoke({ tool, input: { shellId: 'bash_unicode', text: '', end: true } })
    expect(eof.ok && eof.output).toMatchObject({ bytes: 0, ended: true })
  })

  it('rejects malformed input before reaching the shell', async () => {
    let sent = false
    const tool = new ShellInputTool({ writeInput: async () => { sent = true; return { ok: true } } })
    expect((await invoke({ tool, input: { shellId: '', text: 'yes', unexpected: true } })).ok).toBe(false)
    expect(sent).toBe(false)
  })
})
