import { describe, expect, it } from 'bun:test'
import {
  contextTreeRows, contextTreeSelection, moveContextSelection, parentContextPath, sortContextEntries,
  toggleContextExpanded, type ContextTreeLevels,
} from '../context-tree-model'

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

  it('renders expanded children inline while retaining root siblings', () => {
    const rows = contextTreeRows({ levels, expanded: new Set(['notes', 'notes/deep folder']) })
    expect(rows.map((row) => [row.path, row.depth])).toEqual([
      ['notes', 0], ['notes/deep folder', 1], ['notes/deep folder/decision.md', 2], ['notes/plan.md', 1],
      ['file2.ts', 0], ['file10.ts', 0], ['plan.md', 0],
    ])
    expect(new Set(rows.map((row) => row.path)).size).toBe(rows.length)
  })

  it('hides descendants when a parent collapses and remembers nested expansion', () => {
    const expanded = new Set(['notes', 'notes/deep folder'])
    const collapsed = toggleContextExpanded({ expanded, path: 'notes' })
    expect(collapsed.has('notes/deep folder')).toBe(true)
    expect(expanded.has('notes')).toBe(true)
    expect(contextTreeRows({ levels, expanded: collapsed }).map((row) => row.path)).toEqual(['notes', 'file2.ts', 'file10.ts', 'plan.md'])
    const restored = toggleContextExpanded({ expanded: collapsed, path: 'notes' })
    expect(contextTreeRows({ levels, expanded: restored }).some((row) => row.path === 'notes/deep folder/decision.md')).toBe(true)
  })

  it('selects the nearest visible ancestor when a selected child is hidden', () => {
    const rows = contextTreeRows({ levels, expanded: new Set() })
    expect(contextTreeSelection({ rows, selected: 'notes/deep folder/decision.md' })).toBe('notes')
    expect(contextTreeSelection({ rows, selected: 'gone.txt' })).toBe('notes')
    expect(contextTreeSelection({ rows: [], selected: 'gone.txt' })).toBeNull()
  })

  it('moves only among visible rows and clamps at the first and last row', () => {
    const rows = contextTreeRows({ levels, expanded: new Set() })
    expect(moveContextSelection({ rows, selected: 'notes', delta: -1 })).toBe('notes')
    expect(moveContextSelection({ rows, selected: 'notes', delta: 1 })).toBe('file2.ts')
    expect(moveContextSelection({ rows, selected: 'plan.md', delta: 1 })).toBe('plan.md')
    expect(moveContextSelection({ rows: [], selected: null, delta: 1 })).toBeNull()
  })

  it('finds parents without introducing an absolute path', () => {
    expect(parentContextPath('notes/deep folder/decision.md')).toBe('notes/deep folder')
    expect(parentContextPath('notes')).toBe('')
  })
})
