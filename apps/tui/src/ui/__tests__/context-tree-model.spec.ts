import { describe, expect, it } from 'bun:test'
import { contextTreeRows, sortContextEntries, toggleContextClosed, type ContextTreeLevels } from '../context-tree-model'

const levels: ContextTreeLevels = new Map([
  ['', { entries: [{ name: 'file10.ts', isDirectory: false }, { name: 'notes', isDirectory: true },
    { name: 'file2.ts', isDirectory: false }, { name: 'plan.md', isDirectory: false }], error: null }],
  ['notes', { entries: [{ name: 'plan.md', isDirectory: false }, { name: 'deep folder', isDirectory: true }], error: null }],
  ['notes/deep folder', { entries: [{ name: 'decision.md', isDirectory: false }], error: null }],
])

describe('inline context tree model', () => {
  it('sorts folders first and file names naturally without mutating the level', () => {
    const original = levels.get('')?.entries ?? []
    expect(sortContextEntries(original).map((entry) => entry.name)).toEqual(['notes', 'file2.ts', 'file10.ts', 'plan.md'])
    expect(original[0]?.name).toBe('file10.ts')
  })

  it('renders every directory open unless it is listed as closed', () => {
    const rows = contextTreeRows({ levels, closed: new Set() })
    expect(rows.map((row) => [row.path, row.depth])).toEqual([
      ['notes', 0], ['notes/deep folder', 1], ['notes/deep folder/decision.md', 2], ['notes/plan.md', 1],
      ['file2.ts', 0], ['file10.ts', 0], ['plan.md', 0],
    ])
    expect(rows.filter((row) => row.isDirectory).every((row) => row.expanded)).toBe(true)
    expect(new Set(rows.map((row) => row.path)).size).toBe(rows.length)
  })

  it('hides descendants of a closed folder while remembering their own choice', () => {
    const closed = new Set(['notes', 'notes/deep folder'])
    const collapsed = toggleContextClosed({ closed: new Set(['notes/deep folder']), path: 'notes' })
    expect([...collapsed].sort()).toEqual(['notes', 'notes/deep folder'])
    expect(contextTreeRows({ levels, closed }).map((row) => row.path)).toEqual(['notes', 'file2.ts', 'file10.ts', 'plan.md'])
    const reopened = toggleContextClosed({ closed: collapsed, path: 'notes' })
    expect(contextTreeRows({ levels, closed: reopened }).map((row) => [row.path, row.expanded])
      .filter(([path]) => path === 'notes/deep folder')).toEqual([['notes/deep folder', false]])
    expect(closed.has('notes')).toBe(true)
  })

  it('does not mutate the closed set it toggles', () => {
    const closed: ReadonlySet<string> = new Set(['notes'])
    expect(toggleContextClosed({ closed, path: 'notes' }).size).toBe(0)
    expect(closed.has('notes')).toBe(true)
  })

  it('ignores closed entries for folders that no longer exist', () => {
    const rows = contextTreeRows({ levels, closed: new Set(['gone', 'gone/deeper']) })
    expect(rows).toHaveLength(7)
  })
})
