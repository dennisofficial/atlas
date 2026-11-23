import { describe, expect, test } from 'bun:test'

import { EChangeFileStatus, type SessionChangesOutput } from '@dltech/atlas-protocol'

import { diffStatOf, headerModelOf } from '../header-model'
import type { ChangesState } from '../use-changes'

const file = (path: string, additions: number, deletions: number) => ({
  path,
  oldPath: null,
  status: EChangeFileStatus.Modified,
  additions,
  deletions,
  binary: false,
  size: null,
  baseHash: null,
  currentHash: null,
})

const checkout = (repo: string, files: ReturnType<typeof file>[]) => ({
  checkoutId: repo,
  repo,
  worktreePath: `/work/${repo}`,
  base: null,
  updatedAt: 1,
  files,
})

const ready = (checkouts: SessionChangesOutput['checkouts']): ChangesState => ({
  status: 'ready',
  checkouts,
})

describe('the header reading', () => {
  test('sums every file of one checkout', () => {
    expect(diffStatOf([checkout('owner/name', [file('a.ts', 10, 2), file('b.ts', 2, 1)])])).toEqual(
      {
        added: 12,
        removed: 3,
      },
    )
  })

  test('takes the primary checkout when two are present', () => {
    const changes = ready([
      checkout('owner/name', [file('a.ts', 5, 0)]),
      checkout('other/repo', [file('c.ts', 99, 99)]),
    ])
    expect(headerModelOf({ repo: 'owner/name', changes, width: 80 })).toEqual({
      repo: 'name',
      diff: { added: 5, removed: 0 },
    })
  })

  test('draws no stat while the change set is unavailable', () => {
    const changes: ChangesState = { status: 'failed', unavailable: true }
    expect(headerModelOf({ repo: 'owner/name', changes, width: 80 })).toEqual({
      repo: 'name',
      diff: null,
    })
  })

  test('draws no stat for a checkout with no files', () => {
    expect(diffStatOf([checkout('owner/name', [])])).toBeNull()
  })
})
