import { describe, expect, it } from 'bun:test'
import { EToolEffect } from '@dltech/atlas-core'

import { routinesPod } from '..'
import { fakeRoutines, invoke, REFUSAL, rig, textOf } from './support'

const created = {
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
}

describe('routine tools', () => {
  it('declares the six tools, with no child denial', () => {
    const { ctx } = rig()
    expect(routinesPod.tools?.(ctx).map((tool) => tool.name)).toEqual([
      'routine_list',
      'routine_get',
      'routine_create',
      'routine_update',
      'routine_delete',
      'routine_run',
    ])
    expect(routinesPod.childDeny).toBeUndefined()
  })

  it('makes the two listing reads read, and the four writers write', () => {
    const { ctx } = rig()
    const tools = routinesPod.tools?.(ctx) ?? []
    const names = (effect: EToolEffect) =>
      tools.filter((tool) => tool.effect === effect).map((tool) => tool.name)
    expect(names(EToolEffect.Read)).toEqual(['routine_list', 'routine_get'])
    expect(names(EToolEffect.Write)).toEqual([
      'routine_create',
      'routine_update',
      'routine_delete',
      'routine_run',
    ])
  })

  it('routine_list shows each routine with its id, schedule and next run', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'routine_list', input: {} })
    expect(textOf(outcome)).toBe(
      'Routines:\nr1  standup  0 9 * * 1-5 in Europe/London  enabled  next 2026-11-20T09:00:00.000Z  last session none',
    )
  })

  it('routine_list says plainly when the project has none', async () => {
    const { ctx } = rig(fakeRoutines({ routines: [] }).port)
    const outcome = await invoke({ ctx, name: 'routine_list', input: {} })
    expect(textOf(outcome)).toBe('This project has no routines.')
  })

  it('routine_get reads one routine back with its full prompt', async () => {
    const routines = fakeRoutines()
    const { ctx } = rig(routines.port)
    const outcome = await invoke({ ctx, name: 'routine_get', input: { routineId: 'r1' } })
    expect(outcome.ok).toBe(true)
    expect(routines.calls).toEqual(['get:r1'])
    expect(textOf(outcome)).toContain('Prompt:\npost the standup')
    expect(textOf(outcome)).toContain('next run 2026-11-20T09:00:00.000Z')
    expect(outcome.ok && (outcome.output as { prompt: string }).prompt).toBe('post the standup')
  })

  it('routine_get refuses an id this project does not have', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'routine_get', input: { routineId: 'gone' } })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe('routine not found: gone')
  })

  it('routine_create returns the created routine and its next run', async () => {
    const routines = fakeRoutines({ routines: [] })
    const { ctx } = rig(routines.port)
    const outcome = await invoke({ ctx, name: 'routine_create', input: created })
    expect(outcome.ok).toBe(true)
    expect(routines.calls).toEqual(['create'])
    expect(outcome.ok && (outcome.output as { routineId: string }).routineId).toBe('created')
    expect(textOf(outcome)).toContain('next run 2026-11-20T09:00:00.000Z')
  })

  it('routine_update reports the enabled flag and the new next run', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      name: 'routine_update',
      input: { routineId: 'r1', enabled: false },
    })
    expect(textOf(outcome)).toBe(
      'Updated routine standup (r1): "0 9 * * 1-5" in Europe/London, paused, next run 2026-11-20T09:00:00.000Z.',
    )
  })

  it('routine_update refuses an input that changes nothing', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'routine_update', input: { routineId: 'r1' } })
    expect(outcome.ok).toBe(false)
  })

  it('routine_delete removes it, and says plainly when it is gone', async () => {
    const routines = fakeRoutines()
    const { ctx } = rig(routines.port)
    const deleted = await invoke({ ctx, name: 'routine_delete', input: { routineId: 'r1' } })
    expect(textOf(deleted)).toBe('Deleted routine r1.')
    expect(routines.rows.size).toBe(0)
    const again = await invoke({ ctx, name: 'routine_delete', input: { routineId: 'r1' } })
    expect(again.ok).toBe(false)
    expect(textOf(again)).toBe('there is no routine "r1" in this session\'s project')
  })

  it('routine_run returns the session it started', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'routine_run', input: { routineId: 'r1' } })
    expect(textOf(outcome)).toBe('Started routine r1 now in session session-1.')
  })

  it('every tool carries the project refusal through as its reason', async () => {
    const routines = fakeRoutines({ refusal: REFUSAL })
    const { ctx } = rig(routines.port)
    for (const call of [
      { name: 'routine_list', input: {} },
      { name: 'routine_get', input: { routineId: 'r1' } },
      { name: 'routine_create', input: created },
      { name: 'routine_update', input: { routineId: 'r1', name: 'other' } },
      { name: 'routine_delete', input: { routineId: 'r1' } },
      { name: 'routine_run', input: { routineId: 'r1' } },
    ]) {
      const outcome = await invoke({ ctx, ...call })
      expect(outcome.ok).toBe(false)
      expect(textOf(outcome)).toBe(REFUSAL)
    }
  })

  it('routine_run carries the not-found reason through', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, name: 'routine_run', input: { routineId: 'gone' } })
    expect(textOf(outcome)).toBe('routine not found: gone')
  })

  it('routine_list names the project scope in its description', () => {
    const { ctx } = rig()
    const tool = routinesPod.tools?.(ctx).find((candidate) => candidate.name === 'routine_list')
    expect(tool?.description).toContain("this session's project")
    expect(tool?.description).toContain('routine_get')
  })

  it('routine_get says it reads the full prompt, scoped to this project', () => {
    const { ctx } = rig()
    const tool = routinesPod.tools?.(ctx).find((candidate) => candidate.name === 'routine_get')
    expect(tool?.description).toContain("this session's project")
    expect(tool?.description).toContain('full prompt')
  })

  it('routine_create takes optional model settings and leaves them off the input otherwise', async () => {
    const routines = fakeRoutines({ routines: [] })
    const { ctx } = rig(routines.port)
    const outcome = await invoke({
      ctx,
      name: 'routine_create',
      input: { ...created, model: 'anthropic/claude-opus-4-8', fast: true },
    })
    expect(outcome.ok).toBe(true)
    expect(routines.rows.get('created')).toBeDefined()
  })
})
