import { describe, expect, it } from 'bun:test'

import { toThreadId, type ToolOutcome } from '@dltech/atlas-core'

import { CloudConfigTool } from '../cloud-config'
import { type FakePersonalConfig, fakePersonalConfig } from './support-cloud-config'

const invoke = (tool: CloudConfigTool, input: unknown): Promise<ToolOutcome> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  })

const personalTool = (personal: FakePersonalConfig = fakePersonalConfig()): CloudConfigTool =>
  new CloudConfigTool({ personal: personal.client })

const textOf = (outcome: ToolOutcome): string => (outcome.ok ? outcome.modelText : outcome.reason)

describe('CloudConfigTool personal scope', () => {
  it('works on personal scope for settings, secrets and files', async () => {
    const personal = fakePersonalConfig()
    const tool = personalTool(personal)
    await invoke(tool, { kind: 'grant', action: 'set', name: 'PlanetScale', scope: 'personal' })

    const setting = await invoke(tool, {
      kind: 'setting',
      action: 'set',
      name: 'model.fast',
      value: 'true',
      scope: 'personal',
    })
    expect(textOf(setting)).toBe('Set setting model.fast.')
    expect(textOf(await invoke(tool, { kind: 'setting', action: 'list', scope: 'personal' }))).toBe(
      'settings:\nmodel.fast = true',
    )

    await invoke(tool, {
      kind: 'secret',
      action: 'set',
      name: 'TOKEN',
      value: 'x',
      grant: 'PlanetScale',
      scope: 'personal',
    })
    expect(textOf(await invoke(tool, { kind: 'secret', action: 'list', scope: 'personal' }))).toBe(
      'secret names:\nTOKEN (PlanetScale)',
    )

    const refused = await invoke(tool, {
      kind: 'file',
      action: 'set',
      path: 'apps/api/.env.keys',
      contents: 'x',
      grant: 'PlanetScale',
      scope: 'personal',
    })
    expect(textOf(refused)).toBe('Start the path with ~/ or @/')

    const written = await invoke(tool, {
      kind: 'file',
      action: 'set',
      path: '~/.config/atlas.env',
      contents: 'x',
      grant: 'PlanetScale',
      scope: 'personal',
    })
    expect(textOf(written)).toBe(
      'Set file mount ~/.config/atlas.env. It is written on the next sandbox start.',
    )
    expect(personal.state.mounts.get('~/.config/atlas.env')?.mode).toBe(0o600)
  })

  it('offers personal scope and refuses project scope when the session has no project', async () => {
    const tool = personalTool()

    const project = await invoke(tool, { kind: 'setting', action: 'list' })
    expect(project).toEqual({
      ok: false,
      reason: 'this session has no project; use scope personal',
    })

    const personal = await invoke(tool, { kind: 'setting', action: 'list', scope: 'personal' })
    expect(textOf(personal)).toBe('No settings.')
  })
})
