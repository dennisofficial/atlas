import { describe, expect, it } from 'bun:test'
import type { WorktreeChangesRead } from '@dltech/atlas-control'
import { EChangeFileStatus } from '@dltech/atlas-protocol'
import { changedPathsIn, checkoutIn, latestPerWorktree, resolveInside } from './files-checkout'

const root = '/atlas/workspaces/app'

const row = (args: {
  checkoutId: string
  paths: readonly string[]
  updatedAt?: number
  worktreePath?: string
}): WorktreeChangesRead => ({
  checkoutId: args.checkoutId,
  sessionId: 's1',
  repo: 'app',
  worktreePath: args.worktreePath ?? root,
  base: null,
  fingerprint: 'f1',
  updatedAt: args.updatedAt ?? 1,
  files: args.paths.map((path) => ({
    path,
    oldPath: null,
    status: EChangeFileStatus.Modified,
    additions: 0,
    deletions: 0,
    binary: false,
    baseHash: null,
    currentHash: null,
    size: null,
  })),
})

describe('checkoutIn', () => {
  it('finds the row by checkout id', () => {
    const rows = [row({ checkoutId: 'c1', paths: [] }), row({ checkoutId: 'c2', paths: [] })]
    expect(checkoutIn({ checkouts: rows, checkoutId: 'c2' }).checkoutId).toBe('c2')
  })

  it('refuses an id that matches no row', () => {
    expect(() => checkoutIn({ checkouts: [], checkoutId: 'gone' })).toThrow('unknown checkout')
  })
})

describe('latestPerWorktree', () => {
  it('keeps the newest row of a duplicated worktree', () => {
    const rows = [
      row({ checkoutId: 'legacy', paths: ['old.ts'], updatedAt: 5 }),
      row({ checkoutId: 'fresh', paths: ['new.ts'], updatedAt: 9 }),
    ]
    expect(latestPerWorktree(rows).map((entry) => entry.checkoutId)).toEqual(['fresh'])
  })

  it('keeps one row per worktree path', () => {
    const rows = [
      row({ checkoutId: 'c1', paths: [] }),
      row({ checkoutId: 'c2', paths: [], worktreePath: '/atlas/workspaces/other' }),
    ]
    expect(latestPerWorktree(rows).map((entry) => entry.checkoutId)).toEqual(['c1', 'c2'])
  })

  it('answers nothing for no rows', () => {
    expect(latestPerWorktree([])).toEqual([])
  })
})

describe('changedPathsIn', () => {
  it('lists the changed files of the row', () => {
    expect([...changedPathsIn(row({ checkoutId: 'c1', paths: ['a.ts', 'b/c.ts'] }))]).toEqual([
      'a.ts',
      'b/c.ts',
    ])
  })

  it('marks nothing without a row', () => {
    expect(changedPathsIn(undefined).size).toBe(0)
  })
})

describe('resolveInside', () => {
  it('resolves the root itself for an empty path', () => {
    expect(resolveInside({ root, path: '' })).toBe(root)
  })

  it('resolves a relative path against the root', () => {
    expect(resolveInside({ root, path: 'src/a.ts' })).toBe(`${root}/src/a.ts`)
  })

  it('keeps a path that leaves and returns inside the root', () => {
    expect(resolveInside({ root, path: 'src/../lib/a.ts' })).toBe(`${root}/lib/a.ts`)
  })

  it('refuses a parent escape', () => {
    expect(() => resolveInside({ root, path: '../..' })).toThrow('path outside the checkout')
  })

  it('refuses an absolute path outside the root', () => {
    expect(() => resolveInside({ root, path: '/etc/passwd' })).toThrow('path outside the checkout')
  })

  it('allows a directory whose name begins with two dots', () => {
    expect(resolveInside({ root, path: '..notes' })).toBe(`${root}/..notes`)
  })
})
