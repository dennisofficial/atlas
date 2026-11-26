import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'
import { EAccessScope } from '@dltech/atlas-wire/web'

import { CloudConfigTool } from '../cloud-config'
import {
  type FakeCloudConfig,
  type FakePersonalConfig,
  fakeCloudConfig,
  fakePersonalConfig,
} from './support-cloud-config'

const invoke = (tool: CloudConfigTool, input: unknown): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  })

const toolFor = (
  fake: FakeCloudConfig = fakeCloudConfig(),
  personal: FakePersonalConfig = fakePersonalConfig(),
): CloudConfigTool => new CloudConfigTool({ personal: personal.client, project: fake.client })

const textOf = (outcome: ToolOutcome): string => (outcome.ok ? outcome.modelText : outcome.reason)

describe('CloudConfigTool', () => {
  it('writes a group setting through the project group client', async () => {
    const personal = fakePersonalConfig()
    const project = fakeCloudConfig()
    const group = fakePersonalConfig()
    const tool = new CloudConfigTool({
      personal: personal.client,
      project: project.client,
      group: { ...group.client, scope: EAccessScope.Group },
    })

    const set = await invoke(tool, {
      scope: 'group',
      kind: 'setting',
      action: 'set',
      name: 'model.fast',
      value: 'true',
    })

    expect(textOf(set)).toBe('Set setting model.fast.')
    expect(group.state.settings.has('model.fast')).toBe(true)
    expect(project.settings.size).toBe(0)
    expect(personal.state.settings.size).toBe(0)
  })

  it('is the cloud_config tool', () => {
    expect(toolFor().name).toBe('cloud_config')
  })

  it('stays deferred, so its schema costs no prompt space', () => {
    expect(toolFor().deferred).toBe(true)
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
    expect(textOf(read)).toBe('model.fast = true')

    const list = await invoke(tool, { kind: 'setting', action: 'list' })
    expect(textOf(list)).toBe('settings:\nmodel.fast = true')
  })

  it('refuses an unknown setting on read and an unknown setting key on set', async () => {
    const tool = toolFor()

    const read = await invoke(tool, { kind: 'setting', action: 'read', name: 'nope.thing' })
    expect(read).toEqual({ ok: false, reason: 'there is no setting "nope.thing"' })

    const set = await invoke(tool, { kind: 'setting', action: 'set', name: 'NOPE', value: 'x' })
    expect(set.ok).toBe(false)
    expect(textOf(set)).toContain('unknown setting key: NOPE')
  })

  it('refuses a new secret that names no grant', async () => {
    const tool = toolFor()

    const set = await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'SOME_TOKEN',
      value: 'hunter2',
    })
    expect(textOf(set)).toBe('name the grant this secret belongs to (grant: ...)')
  })

  it('refuses a secret that names a grant that does not exist', async () => {
    const tool = toolFor()

    const set = await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'SOME_TOKEN',
      value: 'hunter2',
      grant: 'PlanetScale',
    })
    expect(textOf(set)).toBe('no grant named PlanetScale; create it with kind grant')
  })

  it('lists secret names with their grant and never their values', async () => {
    const tool = toolFor()
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale' })

    const set = await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'SOME_TOKEN',
      value: 'hunter2',
      grant: 'PlanetScale',
    })
    expect(set).toEqual({
      ok: true,
      output: { message: 'Set secret SOME_TOKEN.' },
      modelText: 'Set secret SOME_TOKEN.',
    })

    const list = await invoke(tool, { kind: 'secret', action: 'list' })
    expect(textOf(list)).toBe('secret names:\nSOME_TOKEN (PlanetScale)')
    expect(JSON.stringify(list)).not.toContain('hunter2')
  })

  it('refuses to read a secret and never returns its value', async () => {
    const tool = toolFor()
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale' })
    await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'SOME_TOKEN',
      value: 'hunter2',
      grant: 'PlanetScale',
    })

    const read = await invoke(tool, { kind: 'secret', action: 'read', name: 'SOME_TOKEN' })
    expect(read.ok).toBe(false)
    expect(JSON.stringify(read)).not.toContain('hunter2')
  })

  it('removes a secret that exists and refuses one that does not', async () => {
    const tool = toolFor()
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale' })
    await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'SOME_TOKEN',
      value: 'hunter2',
      grant: 'PlanetScale',
    })

    const removed = await invoke(tool, { kind: 'secret', action: 'remove', name: 'SOME_TOKEN' })
    expect(textOf(removed)).toBe('Removed secret SOME_TOKEN.')
    const missing = await invoke(tool, { kind: 'secret', action: 'remove', name: 'SOME_TOKEN' })
    expect(missing).toEqual({ ok: false, reason: 'there is no secret "SOME_TOKEN"' })
  })

  it('writes a file mount with a mode into a grant, lists it and refuses an unknown one', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await invoke(tool, { kind: 'grant', action: 'set', name: 'dotenvx' })

    const set = await invoke(tool, {
      kind: 'file',
      action: 'set',
      path: '.env.keys',
      contents: 'DOTENV_PRIVATE_KEY=abc',
      grant: 'dotenvx',
    })
    expect(textOf(set)).toBe('Set file mount .env.keys. It is written on the next sandbox start.')
    expect(fake.mounts.get('.env.keys')).toEqual({
      contents: 'DOTENV_PRIVATE_KEY=abc',
      mode: 0o600,
      grant: 'dotenvx',
    })

    const list = await invoke(tool, { kind: 'file', action: 'list' })
    expect(textOf(list)).toBe('file mounts:\n.env.keys (mode 600, dotenvx)')

    const missing = await invoke(tool, { kind: 'file', action: 'remove', path: 'nope' })
    expect(missing).toEqual({ ok: false, reason: 'there is no file mount "nope"' })

    const removed = await invoke(tool, { kind: 'file', action: 'remove', path: '.env.keys' })
    expect(textOf(removed)).toBe('Removed file mount .env.keys.')
  })

  it('lists, reads, renames and removes a grant', async () => {
    const tool = toolFor()

    const set = await invoke(tool, {
      kind: 'grant',
      action: 'set',
      name: 'PlanetScale',
      instruction: 'Use it for database work.',
    })
    expect(textOf(set)).toBe('Set grant PlanetScale.')

    const list = await invoke(tool, { kind: 'grant', action: 'list' })
    expect(textOf(list)).toBe('access grants:\nPlanetScale')

    const read = await invoke(tool, { kind: 'grant', action: 'read', name: 'PlanetScale' })
    expect(textOf(read)).toBe(
      [
        'grant PlanetScale',
        'Environment variables: none',
        'Files: none',
        'Instruction: Use it for database work.',
      ].join('\n'),
    )

    const readMissing = await invoke(tool, { kind: 'grant', action: 'read', name: 'nope' })
    expect(readMissing).toEqual({ ok: false, reason: 'there is no grant "nope"' })

    const renamed = await invoke(tool, {
      kind: 'grant',
      action: 'set',
      name: 'PlanetScale',
      newName: 'Databases',
    })
    expect(textOf(renamed)).toBe('Renamed grant PlanetScale to Databases.')

    const removed = await invoke(tool, { kind: 'grant', action: 'remove', name: 'Databases' })
    expect(textOf(removed)).toBe(
      'Removed grant Databases with its environment variables and files.',
    )
  })

  it('deletes a grant’s members with it', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale' })
    await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'TOKEN',
      value: 'x',
      grant: 'PlanetScale',
    })

    await invoke(tool, { kind: 'grant', action: 'remove', name: 'PlanetScale' })

    expect(fake.secrets.size).toBe(0)
    expect(textOf(await invoke(tool, { kind: 'secret', action: 'list' }))).toBe('No secret names.')
  })

  it('moves a project secret and file to another grant without a value', async () => {
    const fake = fakeCloudConfig()
    const tool = toolFor(fake)
    await invoke(tool, { kind: 'grant', action: 'set', name: 'Scratch' })
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale' })
    await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'TOKEN',
      value: 'x',
      grant: 'Scratch',
    })
    await invoke(tool, {
      kind: 'file',
      action: 'set',
      path: '.env.keys',
      contents: 'x',
      grant: 'Scratch',
    })

    const movedSecret = await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'TOKEN',
      grant: 'PlanetScale',
    })
    expect(textOf(movedSecret)).toBe('Moved secret TOKEN to grant PlanetScale.')
    expect(fake.secrets.get('TOKEN')).toEqual({ value: 'x', grant: 'PlanetScale' })

    const movedFile = await invoke(tool, {
      kind: 'file',
      action: 'set',
      path: '.env.keys',
      grant: 'PlanetScale',
    })
    expect(textOf(movedFile)).toBe('Moved file mount .env.keys to grant PlanetScale.')
    expect(fake.mounts.get('.env.keys')).toEqual({
      contents: 'x',
      mode: 0o600,
      grant: 'PlanetScale',
    })
  })

  it('still demands the value when a set names no grant', async () => {
    const tool = toolFor()

    const secret = await invoke(tool, { kind: 'secret', action: 'set', name: 'TOKEN' })
    expect(secret).toEqual({ ok: false, reason: 'value is required for this action' })

    const file = await invoke(tool, { kind: 'file', action: 'set', path: '.env.keys' })
    expect(file).toEqual({ ok: false, reason: 'contents is required for this action' })
  })

  it('refuses to move a member that does not exist', async () => {
    const tool = toolFor()
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale' })

    expect(
      await invoke(tool, { kind: 'secret', action: 'set', name: 'TOKEN', grant: 'PlanetScale' }),
    ).toEqual({ ok: false, reason: 'there is no secret "TOKEN"' })
    expect(
      await invoke(tool, { kind: 'file', action: 'set', path: '.env.keys', grant: 'PlanetScale' }),
    ).toEqual({ ok: false, reason: 'there is no file mount ".env.keys"' })
  })

  it('moves a group secret through the project group client', async () => {
    const personal = fakePersonalConfig()
    const group = fakePersonalConfig()
    const tool = new CloudConfigTool({
      personal: personal.client,
      group: { ...group.client, scope: EAccessScope.Group },
    })
    await invoke(tool, { scope: 'group', kind: 'grant', action: 'set', name: 'Scratch' })
    await invoke(tool, { scope: 'group', kind: 'grant', action: 'set', name: 'PlanetScale' })
    await invoke(tool, {
      scope: 'group',
      kind: 'secret',
      action: 'set',
      name: 'TOKEN',
      value: 'x',
      grant: 'Scratch',
    })

    const moved = await invoke(tool, {
      scope: 'group',
      kind: 'secret',
      action: 'set',
      name: 'TOKEN',
      grant: 'PlanetScale',
    })

    expect(textOf(moved)).toBe('Moved secret TOKEN to grant PlanetScale.')
    expect(group.state.secrets.get('TOKEN')).toEqual({ value: 'x', grant: 'PlanetScale' })
    expect(personal.state.secrets.size).toBe(0)
  })
})
