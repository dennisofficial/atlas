import { describe, expect, it } from 'bun:test'
import type { DirectoryEntry } from '@dltech/atlas-core'
import { readContextTree, sameContextTreeLevels } from '../context-tree-reader'
import type { ContextTreeLevels } from '../../ui/context-tree-model'

const source = new Map<string, readonly DirectoryEntry[]>([
  ['', [{ name: 'notes', isDirectory: true }, { name: 'other', isDirectory: true }]],
  ['notes', [{ name: 'deep', isDirectory: true }, { name: 'plan.md', isDirectory: false }]],
  ['notes/deep', [{ name: 'decision.md', isDirectory: false }]],
])

describe('reading open context levels', () => {
  it('fetches every directory when nothing is closed', async () => {
    const asked: string[] = []
    const levels = await readContextTree({
      readers: { list: async (path) => { asked.push(path ?? ''); return source.get(path ?? '') ?? [] } },
      closed: new Set(), previous: new Map(),
    })
    expect(asked.sort()).toEqual(['', 'notes', 'notes/deep', 'other'])
    expect([...levels.keys()].sort()).toEqual(['', 'notes', 'notes/deep', 'other'])
  })

  it('skips closed folders and the descendants beneath them', async () => {
    const asked: string[] = []
    await readContextTree({ readers: { list: async (path) => { asked.push(path ?? ''); return source.get(path ?? '') ?? [] } },
      closed: new Set(['notes']), previous: new Map() })
    expect(asked.sort()).toEqual(['', 'other'])
  })

  it('never reads a closed path that is not in the listing', async () => {
    const asked: string[] = []
    await readContextTree({ readers: { list: async (path) => { asked.push(path ?? ''); return source.get(path ?? '') ?? [] } },
      closed: new Set(['vanished', 'vanished/child']), previous: new Map() })
    expect(asked.sort()).toEqual(['', 'notes', 'notes/deep', 'other'])
  })

  it('reports an unreadable level while preserving its last-known entries', async () => {
    const previous: ContextTreeLevels = new Map([['', { entries: source.get('') ?? [], error: null }]])
    const loaded = await readContextTree({ readers: { list: async () => { throw new Error('permission denied') } },
      closed: new Set(), previous })
    expect(loaded.get('')?.entries).toBe(previous.get('')?.entries)
    expect(loaded.get('')?.error).toBe('permission denied')
  })

  it('recognizes equivalent level snapshots without equating changed errors or files', () => {
    const left: ContextTreeLevels = new Map([['', { entries: source.get('') ?? [], error: null }]])
    const right: ContextTreeLevels = new Map([['', { entries: [...(source.get('') ?? [])], error: null }]])
    expect(sameContextTreeLevels({ left, right })).toBe(true)
    expect(sameContextTreeLevels({ left, right: new Map([['', { entries: [], error: null }]]) })).toBe(false)
    expect(sameContextTreeLevels({ left, right: new Map([['', { entries: source.get('') ?? [], error: 'failed' }]]) })).toBe(false)
  })
})
