import { describe, expect, it } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { familyThreadIdsOf } from '../workspace-hooks'

const tree: Record<string, string[]> = {
  root: ['child-a', 'child-b'],
  'child-a': ['grandchild'],
  grandchild: ['root'],
}

const threads = {
  spawned: async ({ threadId }: { threadId: ThreadId }) =>
    (tree[threadId] ?? []).map((id) => ({ id: toThreadId(id) })) as never,
}

describe('the thread family behind a workspace export', () => {
  it('includes the root and every descendant, and terminates on a cycle', async () => {
    const family = await familyThreadIdsOf({ root: toThreadId('root'), threads })

    expect([...family].sort()).toEqual(['child-a', 'child-b', 'grandchild', 'root'].map(toThreadId))
  })

  it('is just the root for a thread that spawned nothing', async () => {
    const family = await familyThreadIdsOf({ root: toThreadId('lonely'), threads })

    expect([...family]).toEqual([toThreadId('lonely')])
  })
})
