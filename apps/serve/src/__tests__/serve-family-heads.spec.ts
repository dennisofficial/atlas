import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { WireThread } from '@dltech/atlas-harness'

import { familyHeads } from '../serve-family-heads'

const ROOT = toThreadId('thread-root')
const CHILD = toThreadId('thread-child')
const GRANDCHILD = toThreadId('thread-grandchild')

const tree = (rows: Record<string, Array<{ id: string; head: number }>>) => {
  const asked: string[] = []
  return {
    asked,
    threads: {
      spawnedThreads: async (args: { threadId: string }) => {
        asked.push(args.threadId)
        return (rows[args.threadId] ?? []) as unknown as WireThread[]
      },
    },
  }
}

describe('familyHeads', () => {
  it('lists the spawned head of every branch point, grandchildren included', async () => {
    const rig = tree({
      [ROOT]: [{ id: CHILD, head: 4 }],
      [CHILD]: [{ id: GRANDCHILD, head: 9 }],
    })

    const heads = await familyHeads({
      root: ROOT,
      agents: [
        { agentId: CHILD, spawnedBy: ROOT },
        { agentId: GRANDCHILD, spawnedBy: CHILD },
      ],
      threads: rig.threads,
    })

    expect([...heads]).toEqual([
      [CHILD, 4],
      [GRANDCHILD, 9],
    ])
    expect(rig.asked).toEqual([ROOT, CHILD])
  })

  it('lists nothing for a family with no children', async () => {
    const rig = tree({})

    expect([...(await familyHeads({ root: ROOT, agents: [], threads: rig.threads }))]).toEqual([])
    expect(rig.asked).toEqual([ROOT])
  })
})
