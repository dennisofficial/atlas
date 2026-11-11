import { describe, expect, it } from 'bun:test'

import type { Routine } from '@dltech/atlas-protocol'

import { draftOf, modelPatchOf } from '../routine-draft'

const routine = (patch: Partial<Routine> = {}): Routine => ({
  routineId: 'routine-1',
  projectId: 'project-1',
  name: 'Morning triage',
  prompt: 'Summarise the PRs that changed overnight.',
  cron: '0 7 * * 1-5',
  timezone: 'Europe/London',
  enabled: true,
  model: null,
  effort: null,
  fast: null,
  nextRunAt: '2026-11-12T07:00:00.000Z',
  lastRunAt: null,
  lastSessionId: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  ...patch,
})

describe('draftOf', () => {
  it('opens a new routine in the user default timezone with a sentence, not a cron', () => {
    const draft = draftOf(undefined, { projectId: 'project-1', defaultTimezone: 'Asia/Tokyo' })
    expect(draft.timezone).toBe('Asia/Tokyo')
    expect(draft.when).toBe('Every weekday at 07:00')
    expect(draft.selection.id).toBe('')
  })

  it('opens an existing routine as the sentence its cron means', () => {
    expect(draftOf(routine(), { projectId: '', defaultTimezone: 'UTC' }).when).toBe(
      'Every weekday at 07:00',
    )
    expect(
      draftOf(routine({ cron: '0 */6 * * *' }), { projectId: '', defaultTimezone: 'UTC' }).when,
    ).toBe('Every 6 hours')
    expect(
      draftOf(routine({ cron: '30 8 1 * *' }), { projectId: '', defaultTimezone: 'UTC' }).when,
    ).toBe('Monthly on the 1st at 08:30')
  })

  it('keeps the routine timezone over the user default', () => {
    const draft = draftOf(routine({ timezone: 'America/New_York' }), {
      projectId: '',
      defaultTimezone: 'Europe/London',
    })
    expect(draft.timezone).toBe('America/New_York')
  })

  it('carries the stored model choice back into the picker', () => {
    const draft = draftOf(routine({ model: 'fable-5.5', effort: 'high', fast: true }), {
      projectId: '',
      defaultTimezone: 'UTC',
    })
    expect(draft.selection).toEqual({ id: 'fable-5.5', effort: 'high', fast: true })
  })
})

describe('modelPatchOf', () => {
  it('clears every model field when the routine follows the account default', () => {
    expect(modelPatchOf({ id: '', effort: 'medium', fast: false })).toEqual({
      model: null,
      effort: null,
      fast: null,
    })
  })

  it('sends the model with its effort and fast flag', () => {
    expect(modelPatchOf({ id: 'opus-5.5', effort: 'high', fast: true })).toEqual({
      model: 'opus-5.5',
      effort: 'high',
      fast: true,
    })
  })
})
