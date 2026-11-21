import { describe, expect, it } from 'bun:test'

import { memoryPod } from '..'
import { MemoryTool } from '../memory-tool'
import { fakeMemory, invoke, rig, textOf } from './support'

const saved = {
  scope: 'global',
  name: 'dennis-prefers-bun',
  description: 'The workspace runs on Bun',
  type: 'user',
  body: 'Bun is the runtime.\n\nWhy: the packages are raw TS.',
}

const address = { scope: 'global', name: 'dennis-prefers-bun' }

describe('the memory tool', () => {
  it('declares one tool for the four actions', () => {
    const { ctx } = rig()
    const tools = memoryPod.tools?.(ctx) ?? []
    expect(tools.map((tool) => tool.name)).toEqual(['memory'])
  })

  it('write saves it', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    const outcome = await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    expect(outcome.ok).toBe(true)
    expect(memory.rows.get('global:dennis-prefers-bun')?.revision).toBe(1)
    expect(textOf(outcome)).toBe('Remembered dennis-prefers-bun (global, revision 1).')
  })

  it('write reports a replacement as a new revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    const again = await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    expect(textOf(again)).toContain('revision 2')
  })

  it('read returns the body, the type and the revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    const outcome = await invoke({ ctx, name: 'memory', input: { action: 'read', ...address } })
    expect(textOf(outcome)).toContain('revision 1')
    expect(textOf(outcome)).toContain('Why: the packages are raw TS.')
  })

  it('read says plainly when there is no such memory', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'memory',
      input: { action: 'read', scope: 'project', name: 'missing' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe('there is no project memory "missing"')
  })

  it('edit replaces a passage and bumps the revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    const edited = await invoke({
      ctx,
      name: 'memory',
      input: {
        action: 'edit',
        ...address,
        old: 'the packages are raw TS',
        new: 'the packages run as raw TS',
        revision: 1,
      },
    })
    expect(textOf(edited)).toBe('Edited dennis-prefers-bun (global, revision 2).')
    expect(memory.rows.get('global:dennis-prefers-bun')?.body).toContain('run as raw TS')
  })

  it('edit surfaces the refusal of a stale revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    const refused = await invoke({
      ctx,
      name: 'memory',
      input: { action: 'edit', ...address, old: 'Bun', new: 'Deno', revision: 7 },
    })
    expect(refused.ok).toBe(false)
    expect(textOf(refused)).toContain('read it again')
  })

  it('delete forgets it, and refuses one that is gone', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'memory', input: { action: 'write', ...saved } })
    const deleted = await invoke({ ctx, name: 'memory', input: { action: 'delete', ...address } })
    expect(textOf(deleted)).toBe('Forgot dennis-prefers-bun (global).')
    expect(memory.rows.size).toBe(0)
    const again = await invoke({ ctx, name: 'memory', input: { action: 'delete', ...address } })
    expect(again.ok).toBe(false)
    expect(textOf(again)).toBe('there is no global memory "dennis-prefers-bun"')
  })

  it('refuses a name that is not lowercase words', async () => {
    const { ctx } = rig()
    const refused = await invoke({
      ctx,
      name: 'memory',
      input: { action: 'write', ...saved, name: 'Not A Name' },
    })
    expect(refused.ok).toBe(false)
  })

  it('takes a body of up to 20000 characters and a description of up to 300', async () => {
    const { ctx } = rig(fakeMemory().port)
    const outcome = await invoke({
      ctx,
      name: 'memory',
      input: {
        action: 'write',
        ...saved,
        scope: 'project',
        body: 'x'.repeat(20_000),
        description: 'd'.repeat(300),
      },
    })
    expect(outcome.ok).toBe(true)
  })

  it.each([
    ['a body over 20000 characters', { body: 'x'.repeat(20_001) }],
    ['a description over 300 characters', { description: 'd'.repeat(301) }],
    ['an unknown type', { type: 'opinion' }],
    ['an unknown scope', { scope: 'team' }],
  ])('refuses %s', async (_label, patch) => {
    const { ctx } = rig()
    const refused = await invoke({
      ctx,
      name: 'memory',
      input: { action: 'write', ...saved, ...patch },
    })
    expect(refused.ok).toBe(false)
  })

  it.each([
    ['write', { action: 'write', ...address }, 'description'],
    ['read', { action: 'read' }, 'scope'],
    ['edit', { action: 'edit', ...address, old: 'a', revision: 1 }, 'new'],
    ['delete', { action: 'delete', name: 'x' }, 'scope'],
  ])('names the action and the field it is missing: %s', async (action, input, field) => {
    const { ctx } = rig()
    const refused = await invoke({ ctx, name: 'memory', input })
    expect(refused.ok).toBe(false)
    expect(textOf(refused)).toContain(`✖ action ${action} needs ${field}`)
  })

  it('carries every field in one input schema, with action required', async () => {
    const { ctx } = rig()
    const tool = new MemoryTool(ctx)
    expect(Object.keys(tool.inputSchema.shape).sort()).toEqual([
      'action',
      'body',
      'description',
      'name',
      'new',
      'old',
      'revision',
      'scope',
      'type',
    ])
    const refused = await invoke({ ctx, name: 'memory', input: {} })
    expect(refused.ok).toBe(false)
  })

  it('lets only read run beside another call', () => {
    const { ctx } = rig()
    const tool = memoryPod.tools?.(ctx)[0]
    expect(tool?.isConcurrencySafe?.({ action: 'read', ...address })).toBe(true)
    expect(tool?.isConcurrencySafe?.({ action: 'write' })).toBe(false)
  })
})
