import { describe, expect, it } from 'bun:test'

import type { V2Event } from '@dltech/atlas-core'

import { ESkillOrigin } from '../../core'
import { latestSkillsOf, repoSkillsOf, skillsClient } from '..'

type Row = { name: string; description: string; argumentHint: string | null; origin: ESkillOrigin }

const row = (overrides: Partial<Row> = {}): Row => ({
  name: 'release-notes',
  description: 'write the release notes',
  argumentHint: null,
  origin: ESkillOrigin.Repo,
  ...overrides,
})

const changed = (skills: readonly Row[], n: number): V2Event =>
  ({
    type: 'skills-changed',
    skills,
    seq: n,
    at: `2026-11-18T12:00:0${n}.000Z`,
    threadId: 's1',
    id: `e${n}`,
  }) as unknown as V2Event

const said = (n: number): V2Event =>
  ({
    type: 'assistant-said',
    text: 'hello',
    seq: n,
    at: `2026-11-18T12:00:0${n}.000Z`,
    threadId: 's1',
    id: `e${n}`,
  }) as unknown as V2Event

describe('skillsClient', () => {
  it('applies its hook to skills-changed only', () => {
    const [hook] = skillsClient.hooks
    expect(hook?.name).toBe('skills-list')
    expect(hook?.appliesTo({ type: 'skills-changed' } as never)).toBe(true)
    expect(hook?.appliesTo({ type: 'assistant-said' } as never)).toBe(false)
  })
})

describe('latestSkillsOf', () => {
  it('is empty when the record never carried a list', () => {
    expect(latestSkillsOf([])).toEqual([])
    expect(latestSkillsOf([said(1)])).toEqual([])
  })

  it('keeps the latest pushed list, not the first', () => {
    const events = [changed([row({ name: 'old' })], 1), changed([row({ name: 'new' })], 2)]
    expect(latestSkillsOf(events).map((skill) => skill.name)).toEqual(['new'])
  })

  it('lets a later empty list wipe the earlier one', () => {
    expect(latestSkillsOf([changed([row()], 1), changed([], 2)])).toEqual([])
  })
})

describe('repoSkillsOf', () => {
  it('keeps only the repo rows of the latest event', () => {
    const events = [
      changed([row()], 1),
      changed(
        [
          row({ name: 'builtin-skill', origin: ESkillOrigin.BuiltIn }),
          row({ name: 'user-skill', origin: ESkillOrigin.CloudUser }),
          row({ name: 'repo-skill' }),
        ],
        2,
      ),
    ]
    expect(repoSkillsOf(events).map((skill) => skill.name)).toEqual(['repo-skill'])
  })

  it('is empty before anything is pushed', () => {
    expect(repoSkillsOf([])).toEqual([])
  })
})
