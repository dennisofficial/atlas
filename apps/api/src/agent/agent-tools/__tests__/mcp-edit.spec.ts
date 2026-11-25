import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import { EMcpServerScope } from '@dltech/atlas-wire/web'

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

const STDIO = { kind: 'stdio', command: 'npx' } as const

describe('McpEditTool', () => {
  it('is the mcp-edit tool', () => {
    expect(toolFor().name).toBe('mcp-edit')
  })

  it('stays deferred, so its schema costs no prompt space', () => {
    expect(toolFor().deferred).toBe(true)
  })

  it('adds a server and lists it with its transport', async () => {
    const tool = toolFor()

    const added = await invoke(tool, { action: 'add', name: 'docs', transport: HTTP })
    expect(textOf(added)).toBe('Set mcp server docs. It applies on the next sandbox start.')

    const list = await invoke(tool, { action: 'list' })
    expect(textOf(list)).toBe('mcp servers:\ndocs http https://mcp.example.com/mcp')
  })

  it('writes the group layer when the scope is group and reports a project with no group', async () => {
    const calls: (EMcpServerScope | undefined)[] = []
    const client = {
      projectId: 'proj-1',
      listMcpServers: async (scope?: EMcpServerScope) => {
        calls.push(scope)
        return []
      },
      readMcpServer: async () => null,
      putMcpServer: async (_server: { name: string }, scope?: EMcpServerScope) => {
        calls.push(scope)
        if (scope === EMcpServerScope.Group) {
          throw new Error('this project has no group, so it has no group mcp servers')
        }
      },
      removeMcpServer: async () => false,
    }
    const tool = new McpEditTool({ client, projectId: 'proj-1' })

    expect((await invoke(tool, { action: 'list', scope: 'group' })).ok).toBe(true)
    expect(calls).toEqual([EMcpServerScope.Group])

    const added = await invoke(tool, {
      action: 'add',
      name: 'docs',
      transport: HTTP,
      scope: 'group',
    })
    expect(textOf(added)).toBe('this project has no group, so it has no group mcp servers')
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
    expect(fake.servers.get('docs')).toEqual({
      name: 'docs',
      transport: HTTP,
      disabled: false,
      proxy: false,
    })
  })

  it('adds a proxied server, marks it in the list, and keeps the switch across disable and enable', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)

    await invoke(tool, { action: 'add', name: 'paper', transport: STDIO, proxy: true })
    expect(textOf(await invoke(tool, { action: 'list' }))).toBe(
      'mcp servers:\npaper stdio npx (on your Mac)',
    )

    await invoke(tool, { action: 'disable', name: 'paper' })
    expect(fake.servers.get('paper')?.proxy).toBe(true)

    await invoke(tool, { action: 'enable', name: 'paper' })
    expect(fake.servers.get('paper')).toEqual({
      name: 'paper',
      transport: STDIO,
      disabled: false,
      proxy: true,
    })
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
      reason: 'mcp server "paused" has no transport. Add a transport to enable it.',
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
