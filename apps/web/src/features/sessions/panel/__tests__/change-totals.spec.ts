import { describe, expect, it } from 'bun:test'

import { EChangeFileStatus } from '@dltech/atlas-protocol'

import type { CheckoutChanges } from '../../changes/use-changes'
import { changeTotalsOf } from '../change-totals'

const checkoutOf = (args: { id: string; lines: [number, number][] }): CheckoutChanges => ({
  checkoutId: args.id,
  repo: 'atlas',
  worktreePath: '/repo',
  base: null,
  updatedAt: 0,
  files: args.lines.map(([additions, deletions], index) => ({
    path: `file-${index}.ts`,
    oldPath: null,
    status: EChangeFileStatus.Modified,
    additions,
    deletions,
    binary: false,
    size: null,
    baseHash: null,
    currentHash: null,
  })),
})

describe('changeTotalsOf', () => {
  it('has no totals until the changes are read', () => {
    expect(
      changeTotalsOf({ changes: { status: 'loading' }, selectedId: undefined }),
    ).toBeUndefined()
  })

  it('sums the files of the selected checkout', () => {
    const changes = {
      status: 'ready' as const,
      checkouts: [
        checkoutOf({ id: 'a', lines: [[1, 1]] }),
        checkoutOf({
          id: 'b',
          lines: [
            [10, 2],
            [5, 0],
          ],
        }),
      ],
    }
    expect(changeTotalsOf({ changes, selectedId: 'b' })).toEqual({
      files: 2,
      added: 15,
      removed: 2,
    })
  })

  it('falls back to the first checkout', () => {
    const changes = {
      status: 'ready' as const,
      checkouts: [checkoutOf({ id: 'a', lines: [[3, 4]] })],
    }
    expect(changeTotalsOf({ changes, selectedId: 'gone' })).toEqual({
      files: 1,
      added: 3,
      removed: 4,
    })
  })
})
