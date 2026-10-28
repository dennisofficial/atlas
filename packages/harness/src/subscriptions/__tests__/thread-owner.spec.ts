import { describe, expect, it } from 'bun:test'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { ThreadStorePort } from '../../store/thread-store'
import { createThreadKinds } from '../thread-owner'

const MAIN = toThreadId('main')
const TEAMMATE = toThreadId('teammate')
const SUBAGENT = toThreadId('subagent')
const GRANDCHILD = toThreadId('grandchild')

const kindsOf = (agents: ReadonlyMap<ThreadId, { spawnedBy: ThreadId; type: string }>) => {
  let asked = 0
  const threads = {
    find: async ({ threadId }: { threadId: ThreadId }) => {
      asked += 1
      const agent = agents.get(threadId)
      return {
        id: threadId,
        head: 0,
        createdAt: '',
        updatedAt: '',
        workspace: null,
        repo: null,
        agent,
      }
    },
  } as unknown as ThreadStorePort

  return { kinds: createThreadKinds({ threads }), asked: () => asked }
}

describe('createThreadKinds', () => {
  it('a root thread owns itself', async () => {
    const { kinds } = kindsOf(new Map())
    expect(await kinds.ownerOf({ threadId: MAIN })).toBe(MAIN)
  })

  it('a teammate owns itself', async () => {
    const { kinds } = kindsOf(new Map([[TEAMMATE, { spawnedBy: MAIN, type: 'teammate' }]]))
    expect(await kinds.ownerOf({ threadId: TEAMMATE })).toBe(TEAMMATE)
  })

  it('a subagent’s owner is its spawner', async () => {
    const { kinds } = kindsOf(new Map([[SUBAGENT, { spawnedBy: MAIN, type: 'explore' }]]))
    expect(await kinds.ownerOf({ threadId: SUBAGENT })).toBe(MAIN)
  })

  it('a nested subagent’s owner walks up to the teammate', async () => {
    const { kinds } = kindsOf(
      new Map<ThreadId, { spawnedBy: ThreadId; type: string }>([
        [GRANDCHILD, { spawnedBy: SUBAGENT, type: 'explore' }],
        [SUBAGENT, { spawnedBy: TEAMMATE, type: 'builder' }],
        [TEAMMATE, { spawnedBy: MAIN, type: 'teammate' }],
      ]),
    )
    expect(await kinds.ownerOf({ threadId: GRANDCHILD })).toBe(TEAMMATE)
  })

  it('memoizes the lookup rather than asking the store twice', async () => {
    const { kinds, asked } = kindsOf(new Map([[SUBAGENT, { spawnedBy: MAIN, type: 'explore' }]]))
    await kinds.ownerOf({ threadId: SUBAGENT })
    await kinds.ownerOf({ threadId: SUBAGENT })
    expect(asked()).toBe(2)
  })
})
