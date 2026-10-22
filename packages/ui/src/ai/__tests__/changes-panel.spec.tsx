import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { DiffLine } from '../diff-viewer'
import { EFileChange } from '../file-tree'
import {
  ChangesPanel,
  type ChangedFile,
  formatCount,
  splitPath,
  totalChanges,
} from '../changes-panel'

const LINES: DiffLine[] = [
  { kind: 'remove', text: 'old line', oldNumber: 1 },
  { kind: 'add', text: 'new line', newNumber: 1 },
]

const FILES: ChangedFile[] = [
  {
    path: 'packages/ui/src/ai/plan.tsx',
    added: 2200,
    removed: 4,
    change: EFileChange.Modified,
    lines: LINES,
  },
  { path: 'README.md', added: 3, removed: 0, change: EFileChange.Added },
  { path: 'old/gone.ts', added: 0, removed: 2, change: EFileChange.Deleted },
]

const SCOPES = [
  { id: 'all', label: 'All changes', detail: '4 commits ahead of origin/main' },
  { id: 'uncommitted', label: 'Uncommitted' },
]

const render = (extra: Partial<Parameters<typeof ChangesPanel>[0]> = {}) =>
  renderToStaticMarkup(<ChangesPanel files={FILES} scopes={SCOPES} scope="all" {...extra} />)

describe('formatCount', () => {
  it('abbreviates thousands', () => {
    expect(formatCount(6)).toBe('6')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(2200)).toBe('2.2k')
    expect(formatCount(12000)).toBe('12k')
  })
})

describe('totalChanges', () => {
  it('sums added and removed', () => {
    expect(totalChanges(FILES)).toEqual({ added: 2203, removed: 6 })
    expect(totalChanges([])).toEqual({ added: 0, removed: 0 })
  })
})

describe('splitPath', () => {
  it('splits name from directory', () => {
    expect(splitPath('packages/ui/src/ai/plan.tsx')).toEqual({
      name: 'plan.tsx',
      dir: 'packages/ui/src/ai',
    })
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' })
  })
})

describe('ChangesPanel', () => {
  it('renders the summary, rows, letters and actions', () => {
    const html = render()

    expect(html).toContain('+2.2k')
    expect(html).toContain('−6')
    expect(html).toContain('3 files')
    expect(html).toContain('plan.tsx')
    expect(html).toContain('packages/ui/src/ai')
    expect(html).toContain('Commit')
    expect(html).toContain('Review')
    expect(html).toContain('Open PR')
    expect(html).toContain('text-diff-add-foreground')
    expect(html).toContain('text-warning')
  })

  it('keeps diffs collapsed by default', () => {
    const html = render()

    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('new line')
  })

  it('expands the diff of a default-expanded row', () => {
    const html = render({ defaultExpanded: ['packages/ui/src/ai/plan.tsx'] })

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('new line')
  })

  it('explains an expanded file that has no diff', () => {
    expect(render({ expanded: ['README.md'] })).toContain('No diff available')
  })

  it('shows the active scope with its detail in the footer', () => {
    expect(render()).toContain('All changes · 4 commits ahead of origin/main')
  })

  it('says so when the scope has no changes', () => {
    const html = render({ files: [] })

    expect(html).toContain('No changes in this scope.')
    expect(html).toContain('0 files')
  })
})
