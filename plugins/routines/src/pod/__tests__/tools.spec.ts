import { describe, expect, it } from 'bun:test'
import { EToolEffect } from '@dltech/atlas-core'

import { routinesPod } from '..'
import { fakeRoutines, invoke, REFUSAL, rig, textOf } from './support'

const created = {
  action: 'create',
  name: 'standup',
  prompt: 'post the standup',
  cron: '0 9 * * 1-5',
  timezone: 'Europe/London',
}

describe('the routine tool', () => {
  it('declares one tool, with no child denial', () => {
    const { ctx } = rig()
    expect(routinesPod.tools?.(ctx).map((tool) => tool.name)).toEqual(['routine'])
    expect(routinesPod.childDeny).toBeUndefined()
  })

  it('writes, and only the two read actions are concurrency safe', () => {
    const { ctx } = rig()
    const tool = routinesPod.tools?.(ctx)[0]
    expect(tool?.effect).toBe(EToolEffect.Write)
    expect(tool?.isConcurrencySafe?.({ action: 'list' })).toBe(true)
    expect(tool?.isConcurrencySafe?.({ action: 'get' })).toBe(true)
    expect(tool?.isConcurrencySafe?.({ action: 'run' })).toBe(false)
  })

  it('states the scheduling rules once, and names every action', () => {
    const { ctx } = rig()
    const description = routinesPod.tools?.(ctx)[0]?.description ?? ''
    expect(description.length).toBeLessThanOrEqual(1_200)
    expect(description).toContain('fresh session')
    expect(description).toContain('every 5 minutes')
    expect(description).toContain('IANA zone')
    for (const action of ['list', 'get', 'create', 'update', 'delete', 'run']) {
      expect(description).toContain(`- ${action}`)
    }
  })

  it('list shows each routine with its id, schedule and next run', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, input: { action: 'list' } })
    expect(textOf(outcome)).toBe(
      'Routines:\nr1  standup  0 9 * * 1-5 in Europe/London  enabled  next 2026-11-20T09:00:00.000Z  last session none',
    )
  })

  it('list says plainly when the project has none', async () => {
    const { ctx } = rig(fakeRoutines({ routines: [] }).port)
    const outcome = await invoke({ ctx, input: { action: 'list' } })
    expect(textOf(outcome)).toBe('This project has no routines.')
  })

  it('get reads one routine back with its full prompt', async () => {
    const routines = fakeRoutines()
    const { ctx } = rig(routines.port)
    const outcome = await invoke({ ctx, input: { action: 'get', routineId: 'r1' } })
    expect(outcome.ok).toBe(true)
    expect(routines.calls).toEqual(['get:r1'])
    expect(textOf(outcome)).toContain('Prompt:\npost the standup')
    expect(textOf(outcome)).toContain('next run 2026-11-20T09:00:00.000Z')
    expect(outcome.ok && (outcome.output as { prompt: string }).prompt).toBe('post the standup')
  })

  it('get refuses an id this project does not have', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, input: { action: 'get', routineId: 'gone' } })
    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toBe('routine not found: gone')
  })

  it('create returns the created routine and its next run', async () => {
    const routines = fakeRoutines({ routines: [] })
    const { ctx } = rig(routines.port)
    const outcome = await invoke({ ctx, input: created })
    expect(outcome.ok).toBe(true)
    expect(routines.calls).toEqual(['create'])
    expect(outcome.ok && (outcome.output as { routineId: string }).routineId).toBe('created')
    expect(textOf(outcome)).toContain('next run 2026-11-20T09:00:00.000Z')
  })

  it('create takes optional model settings', async () => {
    const routines = fakeRoutines({ routines: [] })
    const { ctx } = rig(routines.port)
    const outcome = await invoke({
      ctx,
      input: { ...created, model: 'anthropic/claude-opus-4-8', fast: true },
    })
    expect(outcome.ok).toBe(true)
    expect(routines.rows.get('created')?.fast).toBe(true)
  })

  it('update reports the enabled flag and the new next run', async () => {
    const { ctx } = rig()
    const outcome = await invoke({
      ctx,
      input: { action: 'update', routineId: 'r1', enabled: false },
    })
    expect(textOf(outcome)).toBe(
      'Updated routine standup (r1): "0 9 * * 1-5" in Europe/London, paused, next run 2026-11-20T09:00:00.000Z.',
    )
  })

  it('delete removes it, and says plainly when it is gone', async () => {
    const routines = fakeRoutines()
    const { ctx } = rig(routines.port)
    const deleted = await invoke({ ctx, input: { action: 'delete', routineId: 'r1' } })
    expect(textOf(deleted)).toBe('Deleted routine r1.')
    expect(routines.rows.size).toBe(0)
    const again = await invoke({ ctx, input: { action: 'delete', routineId: 'r1' } })
    expect(again.ok).toBe(false)
    expect(textOf(again)).toBe('there is no routine "r1" in this session\'s project')
  })

  it('run returns the session it started', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, input: { action: 'run', routineId: 'r1' } })
    expect(textOf(outcome)).toBe('Started routine r1 now in session session-1.')
  })

  it('every action carries the project refusal through as its reason', async () => {
    const routines = fakeRoutines({ refusal: REFUSAL })
    const { ctx } = rig(routines.port)
    for (const input of [
      { action: 'list' },
      { action: 'get', routineId: 'r1' },
      created,
      { action: 'update', routineId: 'r1', name: 'other' },
      { action: 'delete', routineId: 'r1' },
      { action: 'run', routineId: 'r1' },
    ]) {
      const outcome = await invoke({ ctx, input })
      expect(outcome.ok).toBe(false)
      expect(textOf(outcome)).toBe(REFUSAL)
    }
  })

  it('run carries the not-found reason through', async () => {
    const { ctx } = rig()
    const outcome = await invoke({ ctx, input: { action: 'run', routineId: 'gone' } })
    expect(textOf(outcome)).toBe('routine not found: gone')
  })

  it('refuses a missing field with a message that names the action', async () => {
    const { ctx } = rig()
    const get = await invoke({ ctx, input: { action: 'get' } })
    expect(textOf(get)).toContain('action "get" needs routineId')
    const create = await invoke({ ctx, input: { action: 'create', name: 'standup' } })
    expect(textOf(create)).toContain('action "create" needs prompt')
    expect(textOf(create)).toContain('action "create" needs cron')
    expect(textOf(create)).toContain('action "create" needs timezone')
    const run = await invoke({ ctx, input: { action: 'run' } })
    expect(textOf(run)).toContain('action "run" needs routineId')
  })

  it('refuses an update that changes nothing, and a null model on create', async () => {
    const { ctx } = rig()
    const update = await invoke({ ctx, input: { action: 'update', routineId: 'r1' } })
    expect(update.ok).toBe(false)
    expect(textOf(update)).toContain('action "update" changes nothing')
    const create = await invoke({ ctx, input: { ...created, model: null } })
    expect(textOf(create)).toContain('action "create" takes model as a value, not null')
  })

  it('refuses an action outside the enum and a field outside the schema', async () => {
    const { ctx } = rig()
    expect((await invoke({ ctx, input: { action: 'pause' } })).ok).toBe(false)
    expect((await invoke({ ctx, input: { action: 'list', projectId: 'p2' } })).ok).toBe(false)
  })
})
