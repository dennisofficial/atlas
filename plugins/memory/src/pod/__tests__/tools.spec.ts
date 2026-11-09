import { describe, expect, it } from 'bun:test'

import { memoryPod, stateFor } from '..'
import { fakeMemory, invoke, rig, textOf } from './support'

const saved = {
  scope: 'global',
  name: 'dennis-prefers-bun',
  description: 'The workspace runs on Bun',
  type: 'user',
  body: 'Bun is the runtime.\n\nWhy: the packages are raw TS.',
}

describe('memory tools', () => {
  it('declares the four tools', () => {
    const { ctx } = rig()
    expect(memoryPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'write_memory',
      'read_memory',
      'edit_memory',
      'delete_memory',
    ])
  })

  it('write_memory saves it and marks the index stale', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    const outcome = await invoke({ ctx, name: 'write_memory', input: saved })
    expect(outcome.ok).toBe(true)
    expect(memory.rows.get('global:dennis-prefers-bun')?.revision).toBe(1)
    expect(textOf(outcome)).toBe('Remembered dennis-prefers-bun (global, revision 1).')
    expect(stateFor(ctx).stale).toBe(true)
  })

  it('write_memory reports a replacement as a new revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'write_memory', input: saved })
    const again = await invoke({ ctx, name: 'write_memory', input: saved })
    expect(textOf(again)).toContain('revision 2')
  })

  it('read_memory returns the body, the type and the revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'write_memory', input: saved })
    const outcome = await invoke({
      ctx,
      name: 'read_memory',
      input: { scope: 'global', name: 'dennis-prefers-bun' },
    })
    expect(textOf(outcome)).toContain('revision 1')
    expect(textOf(outcome)).toContain('Why: the packages are raw TS.')
  })

  it('read_memory says plainly when there is no such memory', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'read_memory',
      input: { scope: 'project', name: 'missing' },
    })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe('there is no project memory "missing"')
  })

  it('edit_memory replaces a passage and bumps the revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'write_memory', input: saved })
    const edited = await invoke({
      ctx,
      name: 'edit_memory',
      input: {
        scope: 'global',
        name: 'dennis-prefers-bun',
        old: 'the packages are raw TS',
        new: 'the packages run as raw TS',
        revision: 1,
      },
    })
    expect(textOf(edited)).toBe('Edited dennis-prefers-bun (global, revision 2).')
    expect(memory.rows.get('global:dennis-prefers-bun')?.body).toContain('run as raw TS')
    expect(stateFor(ctx).stale).toBe(true)
  })

  it('edit_memory surfaces the refusal of a stale revision', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'write_memory', input: saved })
    const refused = await invoke({
      ctx,
      name: 'edit_memory',
      input: { scope: 'global', name: 'dennis-prefers-bun', old: 'Bun', new: 'Deno', revision: 7 },
    })
    expect(refused.ok).toBe(false)
    expect(textOf(refused)).toContain('read it again')
  })

  it('delete_memory forgets it, and refuses one that is gone', async () => {
    const memory = fakeMemory()
    const { ctx } = rig(memory.port)
    await invoke({ ctx, name: 'write_memory', input: saved })
    const deleted = await invoke({
      ctx,
      name: 'delete_memory',
      input: { scope: 'global', name: 'dennis-prefers-bun' },
    })
    expect(textOf(deleted)).toBe('Forgot dennis-prefers-bun (global).')
    expect(memory.rows.size).toBe(0)
    const again = await invoke({
      ctx,
      name: 'delete_memory',
      input: { scope: 'global', name: 'dennis-prefers-bun' },
    })
    expect(again.ok).toBe(false)
    expect(textOf(again)).toBe('there is no global memory "dennis-prefers-bun"')
  })

  it('refuses a name that is not lowercase words', async () => {
    const { ctx } = rig()
    const refused = await invoke({
      ctx,
      name: 'write_memory',
      input: { ...saved, name: 'Not A Name' },
    })
    expect(refused.ok).toBe(false)
  })
})
