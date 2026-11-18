import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { CloudConfigTool } from '../cloud-config'
import { fakeCloudConfig, type FakeCloudConfig } from './support-cloud-config'

const invoke = (tool: CloudConfigTool, input: unknown): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  })

const toolFor = (fake: FakeCloudConfig = fakeCloudConfig()): CloudConfigTool =>
  new CloudConfigTool({ client: fake.client, projectId: fake.client.projectId })

const textOf = (outcome: ToolOutcome): string => (outcome.ok ? outcome.modelText : outcome.reason)

describe('CloudConfigTool', () => {
  it('is the cloud_config tool', () => {
    expect(new CloudConfigTool({ client: fakeCloudConfig().client, projectId: 'prj_1' }).name).toBe(
      'cloud_config',
    )
  })

  it('sets a project setting, then lists and reads it back', async () => {
    const tool = toolFor()

    const set = await invoke(tool, {
      kind: 'setting',
      action: 'set',
      name: 'model.fast',
      value: 'true',
    })
    expect(set).toEqual({
      ok: true,
      output: { message: 'Set setting model.fast.' },
      modelText: 'Set setting model.fast.',
    })

    const read = await invoke(tool, { kind: 'setting', action: 'read', name: 'model.fast' })
    expect(read.ok).toBe(true)
    expect(textOf(read)).toBe('model.fast = true')

    const list = await invoke(tool, { kind: 'setting', action: 'list' })
    expect(textOf(list)).toBe('settings:\nmodel.fast = true')
  })

  it('refuses an unknown setting on read and an unknown setting key on set', async () => {
    const tool = toolFor()

    const read = await invoke(tool, { kind: 'setting', action: 'read', name: 'nope.thing' })
    expect(read).toEqual({ ok: false, reason: 'there is no setting "nope.thing"' })

    const set = await invoke(tool, {
      kind: 'setting',
      action: 'set',
      name: 'NOPE',
      value: 'x',
    })
    expect(set.ok).toBe(false)
    expect(textOf(set)).toContain('unknown setting key: NOPE')
  })

  it('lists secret names only, never their values', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)

    const set = await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'SOME_TOKEN',
      value: 'hunter2',
    })
    expect(set).toEqual({
      ok: true,
      output: { message: 'Set secret SOME_TOKEN.' },
      modelText: 'Set secret SOME_TOKEN.',
    })

    const list = await invoke(tool, { kind: 'secret', action: 'list' })
    expect(textOf(list)).toBe('secret names:\nSOME_TOKEN')
    expect(JSON.stringify(list)).not.toContain('hunter2')
  })

  it('refuses to read a secret and never returns its value', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await fake.client.setSecret({ name: 'SOME_TOKEN', value: 'hunter2' })

    const read = await invoke(tool, { kind: 'secret', action: 'read', name: 'SOME_TOKEN' })
    expect(read.ok).toBe(false)
    expect(JSON.stringify(read)).not.toContain('hunter2')
  })

  it('removes a secret that exists and refuses one that does not', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await fake.client.setSecret({ name: 'SOME_TOKEN', value: 'hunter2' })

    const removed = await invoke(tool, { kind: 'secret', action: 'remove', name: 'SOME_TOKEN' })
    expect(textOf(removed)).toBe('Removed secret SOME_TOKEN.')
    const missing = await invoke(tool, { kind: 'secret', action: 'remove', name: 'SOME_TOKEN' })
    expect(missing).toEqual({ ok: false, reason: 'there is no secret "SOME_TOKEN"' })
  })

  it('writes a file mount with a mode, lists it and refuses an unknown one', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)

    const set = await invoke(tool, {
      kind: 'file',
      action: 'set',
      path: '.env.keys',
      contents: 'DOTENV_PRIVATE_KEY=abc',
    })
    expect(textOf(set)).toBe('Set file mount .env.keys. It is written on the next sandbox start.')
    expect(fake.mounts.get('.env.keys')).toEqual({
      contents: 'DOTENV_PRIVATE_KEY=abc',
      mode: 0o600,
    })

    const list = await invoke(tool, { kind: 'file', action: 'list' })
    expect(textOf(list)).toBe('file mounts:\n.env.keys (mode 600)')

    const missing = await invoke(tool, { kind: 'file', action: 'remove', path: 'nope' })
    expect(missing).toEqual({ ok: false, reason: 'there is no file mount "nope"' })

    const removed = await invoke(tool, { kind: 'file', action: 'remove', path: '.env.keys' })
    expect(textOf(removed)).toBe('Removed file mount .env.keys.')
  })

  it('refuses a client bound to another project', async () => {
    const tool = new CloudConfigTool({
      client: fakeCloudConfig({ projectId: 'prj_2' }).client,
      projectId: 'prj_1',
    })

    const outcome = await invoke(tool, { kind: 'setting', action: 'list' })
    expect(outcome).toEqual({
      ok: false,
      reason: 'this session can only change its own project (prj_1), not prj_2',
    })
  })
})
