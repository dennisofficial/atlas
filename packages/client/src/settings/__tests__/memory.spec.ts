import { describe, expect, it } from 'bun:test'

import type { MemorySummary } from '@dltech/atlas-wire/web'

import {
  EMemoryScope,
  EMemoryType,
  MEMORY_ALL_TYPES,
  MEMORY_GLOBAL_GROUP_ID,
  buildMemoryGroups,
  formatMemoryDate,
  isMemoryTypeFilter,
  memoryClearDescriptionOf,
  memoryGroupLabel,
  memoryKeyInput,
  memoryMatchesFilter,
  memoryScopeHintOf,
  memoryScopeOptionsOf,
  selectedMemoryNamesOf,
  memorySelectionOf,
  memoryDeleteTitleOf,
  type MemoryEntry,
  type MemoryScopeGroup,
} from '../memory'

const entryOf = (args: Partial<MemoryEntry> & { name: string }): MemoryEntry => ({
  description: '',
  type: EMemoryType.User,
  body: '',
  revision: 1,
  updatedAt: '2026-11-27T00:00:00.000Z',
  ...args,
})

const summaryOf = (args: Partial<MemorySummary> & { name: string }): MemorySummary => ({
  scope: EMemoryScope.Global,
  project: null,
  groupId: null,
  description: '',
  type: EMemoryType.User,
  revision: 1,
  updatedAt: '2026-11-27T00:00:00.000Z',
  ...args,
})

const globalGroup: MemoryScopeGroup = {
  id: MEMORY_GLOBAL_GROUP_ID,
  scope: EMemoryScope.Global,
  project: null,
  groupId: null,
  name: null,
  memories: [],
}

describe('buildMemoryGroups', () => {
  it('always shows the global scope and adds one group per scope', () => {
    const groups = buildMemoryGroups({
      memories: [
        summaryOf({ name: 'global-one' }),
        summaryOf({
          name: 'group-one',
          scope: EMemoryScope.Group,
          groupId: 'pgr_1',
        }),
        summaryOf({
          name: 'project-one',
          scope: EMemoryScope.Project,
          project: 'dennisofficial/atlas',
        }),
      ],
      groupNames: new Map([['pgr_1', 'Comp AI']]),
    })
    expect(groups.map((group) => group.id)).toEqual([
      MEMORY_GLOBAL_GROUP_ID,
      'group:pgr_1',
      'dennisofficial/atlas',
    ])
    expect(groups[1]?.name).toBe('Comp AI')
    expect(groups[1]?.memories[0]?.body).toBe('')
  })

  it('drops a group or project memory without its scope id', () => {
    const groups = buildMemoryGroups({
      memories: [
        summaryOf({ name: 'no-group', scope: EMemoryScope.Group }),
        summaryOf({ name: 'no-project', scope: EMemoryScope.Project }),
      ],
      groupNames: new Map(),
    })
    expect(groups).toHaveLength(1)
    expect(groups[0]?.memories).toEqual([])
  })
})

describe('memoryMatchesFilter', () => {
  const entry = entryOf({
    name: 'bun-deflate',
    description: 'Deflate is raw',
    body: 'zlib is not used',
    type: EMemoryType.Reference,
  })

  it('matches an empty filter on every entry', () => {
    expect(memoryMatchesFilter({ entry, query: '', type: MEMORY_ALL_TYPES })).toBe(true)
  })

  it('matches name, description and body, ignoring case', () => {
    expect(memoryMatchesFilter({ entry, query: 'DEFLATE', type: MEMORY_ALL_TYPES })).toBe(true)
    expect(memoryMatchesFilter({ entry, query: 'raw', type: MEMORY_ALL_TYPES })).toBe(true)
    expect(memoryMatchesFilter({ entry, query: 'zlib', type: MEMORY_ALL_TYPES })).toBe(true)
    expect(memoryMatchesFilter({ entry, query: 'missing', type: MEMORY_ALL_TYPES })).toBe(false)
  })

  it('keeps the type filter alongside the search', () => {
    expect(memoryMatchesFilter({ entry, query: '', type: EMemoryType.Reference })).toBe(true)
    expect(memoryMatchesFilter({ entry, query: '', type: EMemoryType.User })).toBe(false)
    expect(memoryMatchesFilter({ entry, query: 'missing', type: EMemoryType.Reference })).toBe(
      false,
    )
  })
})

describe('memory copy', () => {
  const groupOf = (args: Partial<MemoryScopeGroup>): MemoryScopeGroup => ({
    ...globalGroup,
    ...args,
  })

  it('names a scope by its project, group or Global', () => {
    expect(memoryGroupLabel(globalGroup)).toBe('Global')
    expect(
      memoryGroupLabel(groupOf({ scope: EMemoryScope.Group, groupId: 'pgr_1', name: 'Comp AI' })),
    ).toBe('Comp AI')
    expect(memoryGroupLabel(groupOf({ scope: EMemoryScope.Project, project: 'o/r' }))).toBe('o/r')
  })

  it('explains where a scope loads and what clearing it deletes', () => {
    const grouped = groupOf({ scope: EMemoryScope.Group, groupId: 'pgr_1', name: 'Comp AI' })
    expect(memoryScopeHintOf(globalGroup)).toBe('Loaded in every thread, on every project.')
    expect(memoryScopeHintOf(grouped)).toContain('in the Comp AI group')
    expect(memoryClearDescriptionOf(globalGroup)).toBe(
      'Deletes every global memory. Group and project memories are not touched.',
    )
    expect(memoryClearDescriptionOf(grouped)).toContain('Comp AI group')
  })

  it('formats the updated date in UTC', () => {
    expect(formatMemoryDate('2026-11-27T23:30:00.000Z')).toBe('Nov 27, 2026')
  })
})

describe('memory scope options', () => {
  it('labels each scope with its count', () => {
    const groups = [
      { ...globalGroup, memories: [entryOf({ name: 'a' }), entryOf({ name: 'b' })] },
      {
        ...globalGroup,
        id: 'group:pgr_1',
        scope: EMemoryScope.Group,
        groupId: 'pgr_1',
        name: 'Comp AI',
        memories: [],
      },
    ]
    expect(memoryScopeOptionsOf(groups)).toEqual([
      { value: MEMORY_GLOBAL_GROUP_ID, label: 'Global (2)' },
      { value: 'group:pgr_1', label: 'Comp AI (0)' },
    ])
  })
})

describe('memoryKeyInput', () => {
  it('sends only the scope ids that exist', () => {
    expect(
      memoryKeyInput({ scope: EMemoryScope.Global, project: null, groupId: null, name: 'a' }),
    ).toEqual({ scope: EMemoryScope.Global, name: 'a' })
    expect(
      memoryKeyInput({ scope: EMemoryScope.Group, project: null, groupId: 'pgr_1', name: 'a' }),
    ).toEqual({ scope: EMemoryScope.Group, name: 'a', groupId: 'pgr_1' })
  })
})

describe('memory selection', () => {
  it('keeps only names still in the current scope, not only the search results', () => {
    expect(
      selectedMemoryNamesOf({
        selected: ['one', 'gone', 'two'],
        memories: [{ name: 'one' }, { name: 'two' }],
      }),
    ).toEqual(['one', 'two'])
    expect(selectedMemoryNamesOf({ selected: ['one'], memories: [] })).toEqual([])
  })

  it('selects once and removes a name without changing other selections', () => {
    expect(memorySelectionOf({ selectedNames: ['one'], name: 'one', selected: true })).toEqual([
      'one',
    ])
    expect(memorySelectionOf({ selectedNames: ['one'], name: 'two', selected: true })).toEqual([
      'one',
      'two',
    ])
    expect(
      memorySelectionOf({ selectedNames: ['one', 'two'], name: 'one', selected: false }),
    ).toEqual(['two'])
  })

  it('names singular and plural destructive confirmations', () => {
    expect(memoryDeleteTitleOf(1)).toBe('Delete 1 memory?')
    expect(memoryDeleteTitleOf(2)).toBe('Delete 2 memories?')
  })
})

describe('isMemoryTypeFilter', () => {
  it('accepts every memory type and All', () => {
    expect(isMemoryTypeFilter(MEMORY_ALL_TYPES)).toBe(true)
    expect(isMemoryTypeFilter(EMemoryType.Reference)).toBe(true)
    expect(isMemoryTypeFilter('nope')).toBe(false)
  })
})
