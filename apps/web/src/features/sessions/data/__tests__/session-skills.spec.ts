import { describe, expect, it } from 'bun:test'

import {
  ECommandEntryKind,
  ECommandGroup,
  ECommandSource,
  skillEntryOf,
  type CommandEntry,
} from '@dltech/atlas-commands'
import type { RecordEvent } from '@dltech/atlas-core'
import { ESkillOrigin } from '@dltech/atlas-plugin-skills/core'

import { repoSkillEntriesOf, skillMenuEntries } from '../session-skills'

type Row = { name: string; description: string; argumentHint: string | null; origin: ESkillOrigin }

const repoRow = (overrides: Partial<Row> = {}): Row => ({
  name: 'release-notes',
  description: 'write the release notes',
  argumentHint: '[version]',
  origin: ESkillOrigin.Repo,
  ...overrides,
})

const changed = (skills: readonly Row[], n: number): RecordEvent =>
  ({
    type: 'skills-changed',
    skills,
    seq: n,
    at: `2026-11-18T12:00:0${n}.000Z`,
    threadId: 's1',
    id: `e${n}`,
  }) as unknown as RecordEvent

const catalogueEntry = (overrides: Partial<CommandEntry> = {}): CommandEntry => ({
  ...skillEntryOf({
    name: 'builtin-skill',
    description: 'a skill the cloud catalogue lists',
    argumentHint: null,
  }),
  ...overrides,
})

const namesOf = (entries: readonly CommandEntry[]): readonly string[] =>
  entries.map((entry) => entry.name).sort()

const menuOf = (args: { events: readonly RecordEvent[]; catalogue?: readonly CommandEntry[] }) =>
  skillMenuEntries({ catalogue: args.catalogue ?? [catalogueEntry()], events: args.events })

describe('repoSkillEntriesOf', () => {
  it('maps a pushed repo skill into a workspace skill row', () => {
    expect(repoSkillEntriesOf([changed([repoRow()], 1)])).toEqual([
      {
        name: 'release-notes',
        summary: 'write the release notes',
        group: ECommandGroup.Workspace,
        argumentHint: '[version]',
        kind: ECommandEntryKind.Skill,
        source: ECommandSource.Skill,
      },
    ])
  })

  it('has no argument hint when the skill declares none', () => {
    const [entry] = repoSkillEntriesOf([changed([repoRow({ argumentHint: null })], 1)])
    expect(entry?.argumentHint).toBeUndefined()
  })

  it('leaves out the built-in and user rows the pod also reports', () => {
    const events = [
      changed(
        [
          repoRow({ name: 'builtin-skill', origin: ESkillOrigin.BuiltIn }),
          repoRow({ name: 'user-skill', origin: ESkillOrigin.CloudUser }),
          repoRow(),
        ],
        1,
      ),
    ]
    expect(namesOf(repoSkillEntriesOf(events))).toEqual(['release-notes'])
  })
})

describe('the / menu of a v2 session', () => {
  it('shows the cloud catalogue before the pod pushes anything', () => {
    expect(namesOf(menuOf({ events: [] }))).toEqual(['builtin-skill'])
  })

  it('shows a repo skill as soon as the pod pushes it', () => {
    expect(namesOf(menuOf({ events: [changed([repoRow()], 1)] }))).toEqual([
      'builtin-skill',
      'release-notes',
    ])
  })

  it('drops a repo skill the pod reports gone', () => {
    const events = [changed([repoRow()], 1), changed([], 2)]
    expect(namesOf(menuOf({ events }))).toEqual(['builtin-skill'])
  })

  it('keeps only the latest push', () => {
    const events = [changed([repoRow({ name: 'gone' })], 1), changed([repoRow()], 2)]
    expect(namesOf(menuOf({ events }))).toEqual(['builtin-skill', 'release-notes'])
  })

  it('lets a repo skill shadow a catalogue skill of the same name', () => {
    const catalogue = [catalogueEntry({ name: 'release-notes', summary: 'the cloud copy' })]
    const entries = menuOf({ events: [changed([repoRow()], 1)], catalogue })
    expect(namesOf(entries)).toEqual(['release-notes'])
    expect(entries[0]?.summary).toBe('write the release notes')
  })
})
