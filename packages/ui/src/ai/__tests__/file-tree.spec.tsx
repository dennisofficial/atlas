import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EFileChange, FileTree, nameClassOf, openPropsOf, type FileNode } from '../file-tree'

const NODES: FileNode[] = [
  {
    path: 'src',
    name: 'src',
    change: EFileChange.Modified,
    children: [
      { path: 'src/a.ts', name: 'a.ts', change: EFileChange.Modified },
      { path: 'src/new.ts', name: 'new.ts', change: EFileChange.Added },
      { path: 'src/gone.ts', name: 'gone.ts', change: EFileChange.Deleted },
    ],
  },
  { path: 'dist', name: 'dist', ignored: true, children: [] },
  { path: 'README.md', name: 'README.md' },
]

describe('FileTree git decoration', () => {
  it('tints names by status and strikes through a deleted file', () => {
    expect(nameClassOf({ change: EFileChange.Modified })).toContain('text-warning')
    expect(nameClassOf({ change: EFileChange.Added })).toContain('text-diff-add-foreground')
    expect(nameClassOf({ change: EFileChange.Deleted })).toContain('line-through')
    expect(nameClassOf({ change: EFileChange.Deleted, children: [] })).not.toContain('line-through')
  })

  it('dims an ignored path and leaves an unchanged one plain', () => {
    expect(nameClassOf({ ignored: true })).toContain('text-muted-foreground')
    expect(nameClassOf({})).toBe('truncate')
  })

  it('keeps the status letter on files and names every status for screen readers', () => {
    const markup = renderToStaticMarkup(<FileTree nodes={NODES} />)
    for (const mark of ['>M<', '>A<', '>D<']) expect(markup).toContain(mark)
    for (const label of [
      ', holds modified files',
      ', modified',
      ', added',
      ', deleted',
      ', ignored by git',
    ])
      expect(markup).toContain(label)
  })
})

describe('FileTree lazy folders', () => {
  const lazy: FileNode[] = [{ path: 'src', name: 'src', children: [], loaded: false }]

  it('shows a loading row inside an open, unloaded folder only', () => {
    expect(renderToStaticMarkup(<FileTree nodes={lazy} open={['src']} />)).toContain('Loading')
    expect(renderToStaticMarkup(<FileTree nodes={lazy} open={[]} />)).not.toContain('Loading')
  })

  it('controls openness from the open list and reports changes', () => {
    const seen: unknown[] = []
    const props = openPropsOf({
      path: 'src',
      open: ['src'],
      defaultOpen: false,
      onOpenChange: (change) => seen.push(change),
    })
    expect(props.open).toBe(true)
    props.onOpenChange(false)
    expect(seen).toEqual([{ path: 'src', open: false }])
  })

  it('never gives folder rows the expanded highlight', () => {
    const markup = renderToStaticMarkup(<FileTree nodes={lazy} />)
    expect(markup).not.toContain('aria-expanded:bg-muted')
  })
})
