import { describe, expect, it } from 'bun:test'
import {
  eventIdSchema,
  hashSchema,
  runIdSchema,
  threadIdSchema,
  type RecordEvent,
} from '@dltech/atlas-core'

import { enteredWorktreePathOf } from '../entered-worktree'

const HASH = hashSchema.parse('0'.repeat(64))

const stamp = (args: { seq: number; threadId: string }) => ({
  id: eventIdSchema.parse(`ev_${args.seq}`),
  seq: args.seq,
  threadId: threadIdSchema.parse(args.threadId),
  runId: runIdSchema.parse('run_1'),
  depth: 0,
  at: '2026-11-22T10:00:00.000Z',
  epoch: 1,
  prevHash: HASH,
  hash: HASH,
})

const entered = (args: { seq: number; threadId: string; path: string }): RecordEvent => ({
  ...stamp({ seq: args.seq, threadId: args.threadId }),
  type: 'worktree-entered',
  path: args.path,
  branch: 'dennis/wt',
})

const exited = (args: { seq: number; threadId: string; path: string }): RecordEvent => ({
  ...stamp({ seq: args.seq, threadId: args.threadId }),
  type: 'worktree-exited',
  path: args.path,
  action: 'keep',
})

describe('enteredWorktreePathOf', () => {
  it('finds the worktree the thread entered', () => {
    const path = enteredWorktreePathOf({
      events: [entered({ seq: 1, threadId: 't1', path: '/work/wt' })],
      threadId: 't1',
    })
    expect(path).toBe('/work/wt')
  })

  it('ignores what another thread entered', () => {
    const path = enteredWorktreePathOf({
      events: [
        entered({ seq: 1, threadId: 't1', path: '/work/one' }),
        entered({ seq: 2, threadId: 't2', path: '/work/two' }),
      ],
      threadId: 't1',
    })
    expect(path).toBe('/work/one')
  })

  it('answers nothing once the thread leaves the worktree', () => {
    const path = enteredWorktreePathOf({
      events: [
        entered({ seq: 1, threadId: 't1', path: '/work/wt' }),
        exited({ seq: 2, threadId: 't1', path: '/work/wt' }),
      ],
      threadId: 't1',
    })
    expect(path).toBeUndefined()
  })

  it('finds a worktree entered before the visible tail', () => {
    const retained = [entered({ seq: 1, threadId: 't1', path: '/work/wt' })]
    const tail = retained.slice(1)

    expect(enteredWorktreePathOf({ events: tail, threadId: 't1' })).toBeUndefined()
    expect(enteredWorktreePathOf({ events: retained, threadId: 't1' })).toBe('/work/wt')
  })

  it('answers nothing before any worktree is entered', () => {
    expect(enteredWorktreePathOf({ events: [], threadId: 't1' })).toBeUndefined()
  })
})
