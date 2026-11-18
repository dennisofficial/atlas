import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { McpEditTool } from '../mcp-edit'
import { fakeCloudConfig, type FakeCloudConfig } from './support-cloud-config'

const invoke = (tool: McpEditTool, input: unknown): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  })

const toolFor = (fake: FakeCloudConfig = fakeCloudConfig()): McpEditTool =>
  new McpEditTool({ client: fake.client, projectId: fake.client.projectId })

const textOf = (outcome: ToolOutcome): string => (outcome.ok ? outcome.modelText : outcome.reason)

const HTTP = { kind: 'http', url: 'https://mcp.example.com/mcp' } as const

describe('McpEditTool', () => {
  it('is the mcp-edit tool', () => {
    expect(toolFor().name).toBe('mcp-edit')
  })

  it('adds a server and lists it with its transport', async () => {
    const tool = toolFor()

    const added = await invoke(tool, { action: 'add', name: 'docs', transport: HTTP })
    expect(textOf(added)).toBe('Set mcp server docs. It applies on the next sandbox start.')

    const list = await invoke(tool, { action: 'list' })
    expect(textOf(list)).toBe('mcp servers:\ndocs http https://mcp.example.com/mcp')
  })

  it('requires a transport to add a server', async () => {
    const outcome = await invoke(toolFor(), { action: 'add', name: 'docs' })
    expect(outcome).toEqual({ ok: false, reason: 'transport is required to add a server' })
  })

  it('disables a server, keeping its transport, then enables it again', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await invoke(tool, { action: 'add', name: 'docs', transport: HTTP })

    const disabled = await invoke(tool, { action: 'disable', name: 'docs' })
    expect(textOf(disabled)).toBe('Disabled mcp server docs. It applies on the next sandbox start.')
    expect(textOf(await invoke(tool, { action: 'list' }))).toContain('(disabled)')

    const enabled = await invoke(tool, { action: 'enable', name: 'docs' })
    expect(textOf(enabled)).toBe('Enabled mcp server docs. It applies on the next sandbox start.')
    expect(fake.servers.get('docs')).toEqual({ name: 'docs', transport: HTTP, disabled: false })
  })

  it('refuses to enable or disable a server that does not exist', async () => {
    const tool = toolFor()

    for (const action of ['enable', 'disable'] as const) {
      expect(await invoke(tool, { action, name: 'nope' })).toEqual({
        ok: false,
        reason: 'there is no mcp server "nope"',
      })
    }
  })

  it('refuses to enable a stored stub that has no transport', async () => {
    const fake = fakeCloudConfig()
    await fake.client.putMcpServer({ name: 'paused', transport: undefined, disabled: true })

    const outcome = await invoke(toolFor(fake), { action: 'enable', name: 'paused' })
    expect(outcome).toEqual({
      ok: false,
      reason: 'mcp server "paused" has no transport; add it with a transport to enable it',
    })
  })

  it('removes a server and refuses one that does not exist', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await invoke(tool, { action: 'add', name: 'docs', transport: HTTP })

    expect(textOf(await invoke(tool, { action: 'remove', name: 'docs' }))).toBe(
      'Removed mcp server docs. It applies on the next sandbox start.',
    )
    expect(await invoke(tool, { action: 'remove', name: 'docs' })).toEqual({
      ok: false,
      reason: 'there is no mcp server "docs"',
    })
  })

  it('refuses a client bound to another project', async () => {
    const tool = new McpEditTool({
      client: fakeCloudConfig({ projectId: 'prj_2' }).client,
      projectId: 'prj_1',
    })

    expect(await invoke(tool, { action: 'list' })).toEqual({
      ok: false,
      reason: 'this session can only change its own project (prj_1), not prj_2',
    })
  })
})
