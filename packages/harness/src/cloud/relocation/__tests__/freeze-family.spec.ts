import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'

import { holdFamilyIntake } from '../freeze-family'

const root = toThreadId('brn_freeze_root')
const child = toThreadId('brn_freeze_child')

const summary = (id: typeof root) => ({
  id,
  head: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  workspace: null,
  repo: null,
})

describe('holding source-family intake for a handoff', () => {
  it('holds every family member once and releases the holds exactly once', async () => {
    const held: string[] = []
    const released: string[] = []
    const release = await holdFamilyIntake({
      threadId: root,
      threads: { spawned: async ({ threadId }) => threadId === root ? [summary(child)] : [summary(root)] },
      intake: { hold: ({ threadId }) => { held.push(threadId); return () => { released.push(threadId) } } },
    })
    expect(held).toEqual([root, child])
    expect(released).toEqual([])
    release()
    release()
    expect(released).toEqual([root, child])
  })

  it('releases all reservations if family discovery fails', async () => {
    const released: string[] = []
    await expect(holdFamilyIntake({
      threadId: root,
      threads: { spawned: async () => { throw new Error('could not read children') } },
      intake: { hold: ({ threadId }) => () => { released.push(threadId) } },
    })).rejects.toThrow('could not read children')
    expect(released).toEqual([root])
  })
})
