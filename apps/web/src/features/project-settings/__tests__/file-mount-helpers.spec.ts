import { describe, expect, it } from 'bun:test'

import { ERepoTreeEntryKind } from '@dltech/atlas-wire/web'

import {
  formatFileMode,
  MAX_PICKER_CHOICES,
  parseFileMode,
  pickerChoices,
  type TreeEntry,
} from '../data/file-mount-helpers'

const entries: TreeEntry[] = [
  { path: 'src', kind: ERepoTreeEntryKind.Folder },
  { path: 'src/app.ts', kind: ERepoTreeEntryKind.File },
  { path: '.env.example', kind: ERepoTreeEntryKind.File },
  { path: 'docs/env.md', kind: ERepoTreeEntryKind.File },
]

describe('file mode', () => {
  it('parses three or four octal digits', () => {
    expect(parseFileMode('0600')).toBe(0o600)
    expect(parseFileMode('644')).toBe(0o644)
    expect(parseFileMode(' 0755 ')).toBe(0o755)
  })
  it('rejects anything else', () => {
    for (const text of ['', '0800', '06000', 'rw-', '12', '-600']) {
      expect(parseFileMode(text)).toBeNull()
    }
  })
  it('formats with four digits', () => {
    expect(formatFileMode(0o600)).toBe('0600')
    expect(formatFileMode(0o7)).toBe('0007')
    expect(formatFileMode(0o755)).toBe('0755')
  })
})

describe('pickerChoices', () => {
  it('marks folders with a trailing slash', () => {
    expect(pickerChoices({ entries, query: 'src' })).toEqual(['src/', 'src/app.ts'])
  })
  it('filters case-insensitively and ranks prefix matches first', () => {
    expect(pickerChoices({ entries, query: 'ENV' })).toEqual(['docs/env.md', '.env.example'])
    expect(pickerChoices({ entries, query: '.env' })).toEqual(['.env.example'])
  })
  it('returns everything for an empty query, capped', () => {
    expect(pickerChoices({ entries, query: '' })).toHaveLength(4)
    const many = Array.from({ length: 80 }, (_, index) => ({
      path: `f${index}`,
      kind: ERepoTreeEntryKind.File,
    }))
    expect(pickerChoices({ entries: many, query: '' })).toHaveLength(MAX_PICKER_CHOICES)
  })
  it('suggests nothing for a home path', () => {
    expect(pickerChoices({ entries, query: '~/.config' })).toEqual([])
  })
})
