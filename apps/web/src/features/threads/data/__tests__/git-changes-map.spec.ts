import { describe, expect, it } from 'bun:test'

import { EFileChange } from '@dltech/atlas-ui/ai/changes-panel'
import {
  EChangeScope,
  EChangeStatus,
  EDiffLineKind,
  type ChangedFileWire,
} from '@dltech/atlas-wire/web'

import {
  CHANGE_SCOPES,
  TRUNCATED_DIFF_TEXT,
  changeByPath,
  changeScopeOf,
  changedFileOf,
  diffLinesOf,
} from '../git-changes-map'

const wire = (overrides: Partial<ChangedFileWire> = {}): ChangedFileWire => ({
  path: 'src/a.ts',
  status: EChangeStatus.Modified,
  additions: 2,
  deletions: 1,
  binary: false,
  truncated: false,
  hunks: [
    {
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: EDiffLineKind.Context, text: 'one', oldNumber: 1, newNumber: 1 },
        { kind: EDiffLineKind.Remove, text: 'two', oldNumber: 2 },
        { kind: EDiffLineKind.Add, text: 'TWO', newNumber: 2 },
      ],
    },
    {
      header: '@@ -10,2 +11,2 @@',
      lines: [
        { kind: EDiffLineKind.Context, text: 'ten', oldNumber: 10, newNumber: 11 },
        { kind: EDiffLineKind.Add, text: 'eleven', newNumber: 12 },
      ],
    },
  ],
  ...overrides,
})

describe('changedFileOf', () => {
  it('maps counts, status and the first hunk header', () => {
    const file = changedFileOf(wire())
    expect(file.path).toBe('src/a.ts')
    expect(file.added).toBe(2)
    expect(file.removed).toBe(1)
    expect(file.change).toBe(EFileChange.Modified)
    expect(file.hunk).toBe('@@ -1,3 +1,4 @@')
  })

  it.each([
    [EChangeStatus.Added, EFileChange.Added],
    [EChangeStatus.Modified, EFileChange.Modified],
    [EChangeStatus.Deleted, EFileChange.Deleted],
  ])('maps status %s', (status, change) => {
    expect(changedFileOf(wire({ status })).change).toBe(change)
  })

  it('omits the hunk and keeps empty lines when there are no hunks', () => {
    const file = changedFileOf(wire({ hunks: [] }))
    expect(file.hunk).toBeUndefined()
    expect(file.lines).toEqual([])
  })

  it('leaves lines undefined for a binary file', () => {
    expect(changedFileOf(wire({ binary: true, hunks: [] })).lines).toBeUndefined()
  })
})

describe('diffLinesOf', () => {
  it('maps line kinds and numbers without inventing missing ones', () => {
    const lines = diffLinesOf(wire({ hunks: [wire().hunks[0]!] }))
    expect(lines).toEqual([
      { kind: 'context', text: 'one', oldNumber: 1, newNumber: 1 },
      { kind: 'remove', text: 'two', oldNumber: 2 },
      { kind: 'add', text: 'TWO', newNumber: 2 },
    ])
  })

  it('puts one gap row between hunks naming the hidden lines', () => {
    const lines = diffLinesOf(wire())
    const gaps = lines.filter((line) => line.kind === 'gap')
    expect(gaps).toEqual([{ kind: 'gap', text: '7 unchanged lines' }])
    expect(lines[3]?.kind).toBe('gap')
    expect(lines).toHaveLength(6)
  })

  it('falls back to the next hunk header when the gap cannot be measured', () => {
    const file = wire({
      hunks: [
        { header: '@@ -0,0 +1 @@', lines: [{ kind: EDiffLineKind.Add, text: 'a', newNumber: 1 }] },
        { header: '@@ -0,0 +9 @@', lines: [{ kind: EDiffLineKind.Add, text: 'b', newNumber: 9 }] },
      ],
    })
    expect(diffLinesOf(file)[1]).toEqual({ kind: 'gap', text: '@@ -0,0 +9 @@' })
  })

  it('appends a truncation row for a truncated file', () => {
    const lines = diffLinesOf(wire({ truncated: true, hunks: [wire().hunks[0]!] }))
    expect(lines.at(-1)).toEqual({ kind: 'gap', text: TRUNCATED_DIFF_TEXT })
  })
})

describe('scopes', () => {
  it('offers all three wire scopes in order', () => {
    expect(CHANGE_SCOPES.map((scope) => scope.id)).toEqual([
      EChangeScope.All,
      EChangeScope.Uncommitted,
      EChangeScope.LastCommit,
    ])
  })

  it('parses a known scope id and rejects an unknown one', () => {
    expect(changeScopeOf('last-commit')).toBe(EChangeScope.LastCommit)
    expect(changeScopeOf('nope')).toBeUndefined()
  })
})

describe('changeByPath', () => {
  it('indexes the change kind by path', () => {
    const map = changeByPath([changedFileOf(wire()), changedFileOf(wire({ path: 'b.ts' }))])
    expect(map.get('src/a.ts')).toBe(EFileChange.Modified)
    expect(map.has('c.ts')).toBe(false)
  })
})
