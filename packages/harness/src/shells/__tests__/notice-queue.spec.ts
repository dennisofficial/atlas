import { describe, expect, it } from 'bun:test'

import { EShellStatus, toThreadId } from '@dltech/atlas-core'

import type { ShellSnapshot } from '../background-shell'
import { ENotice, ShellAttentionQueue } from '../attention'
import { toShellId } from '../shell-id'

const THREAD = toThreadId('thread-under-test')

const snapshotOf = (args: {
  shellId: string
  status: EShellStatus
}): ShellSnapshot => ({
  shellId: toShellId(args.shellId),
  threadId: THREAD,
  command: 'echo done',
  description: 'Finish a job',
  status: args.status,
  exitCode: args.status === EShellStatus.Running ? undefined : 0,
  startedAt: '2026-08-27T12:00:00.000Z',
  lastOutputAt: '2026-08-27T12:00:01.000Z',
  endedAt: args.status === EShellStatus.Running ? undefined : '2026-08-27T12:00:01.000Z',
  totalCharacters: 5,
  awaitingInput: false,
})

describe('the shell notice queue as a wake-up bell', () => {
  it('wakes the turn for any notice but never yields a draft', () => {
    const ended = endedSnapshotOf('bash_1')
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Ended, snapshot: ended, threadId: THREAD })

    const batch = queue.prepare({ threadId: THREAD })

    expect(batch.drafts).toEqual([])
    expect(batch.wakesTurn).toBe(true)
    batch.acknowledge()
    expect(queue.pending({ threadId: THREAD })).toEqual([])
  })

  it('holds a pending row per queued notice until acknowledged', () => {
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Matched, snapshot: liveSnapshotOf('bash_1'), threadId: THREAD })
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshotOf('bash_2'), threadId: THREAD })

    const pending = queue.pending({ threadId: THREAD })

    expect(pending.map((notice) => notice.kind)).toEqual([ENotice.Matched, ENotice.Ended])
  })

  it('rings for durable facts even when the process has since ended', () => {
    const ended = endedSnapshotOf('bash_1')
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.AwaitingInput, snapshot: ended, threadId: THREAD })
    queue.queue({ kind: ENotice.Matched, snapshot: ended, threadId: THREAD })

    const batch = queue.prepare({ threadId: THREAD })

    expect(batch.wakesTurn).toBe(true)
  })

  it('rings for an alive-claim notice while its shell is still running', () => {
    const live = liveSnapshotOf('bash_1')
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Matched, snapshot: live, threadId: THREAD })

    const batch = queue.prepare({ threadId: THREAD })

    expect(batch.wakesTurn).toBe(true)
  })
})

describe('reassigning a finished thread’s notices', () => {
  const CHILD = toThreadId('child-thread')
  const PARENT = toThreadId('parent-thread')

  it('moves every queued notice to the parent, preserving order', () => {
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshotOf('bash_1'), threadId: CHILD })
    queue.queue({ kind: ENotice.Matched, snapshot: liveSnapshotOf('bash_2'), threadId: CHILD })

    queue.reassign({ from: CHILD, to: PARENT })

    expect(queue.pending({ threadId: CHILD })).toEqual([])
    expect(queue.pending({ threadId: PARENT }).map((notice) => notice.kind)).toEqual([
      ENotice.Ended,
      ENotice.Matched,
    ])
    expect(queue.threadsAwaiting()).toEqual([PARENT])
  })

  it('leaves other threads’ notices where they are', () => {
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshotOf('bash_1'), threadId: CHILD })
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshotOf('bash_2'), threadId: THREAD })

    queue.reassign({ from: CHILD, to: PARENT })

    expect(queue.pending({ threadId: THREAD })).toHaveLength(1)
    expect(queue.pending({ threadId: PARENT })).toHaveLength(1)
  })

  it('is a no-op when the finished thread left nothing, and never fires a listener', () => {
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshotOf('bash_1'), threadId: THREAD })
    let rang = 0
    queue.onNotice(() => { rang += 1 })

    queue.reassign({ from: CHILD, to: PARENT })

    expect(rang).toBe(0)
    expect(queue.pending({ threadId: THREAD })).toHaveLength(1)
  })

  it('is a no-op when from and to are the same thread', () => {
    const queue = new ShellAttentionQueue()
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshotOf('bash_1'), threadId: CHILD })

    queue.reassign({ from: CHILD, to: CHILD })

    expect(queue.pending({ threadId: CHILD })).toHaveLength(1)
  })
})

const liveSnapshotOf = (shellId: string): ShellSnapshot =>
  snapshotOf({ shellId, status: EShellStatus.Running })
const endedSnapshotOf = (shellId: string): ShellSnapshot =>
  snapshotOf({ shellId, status: EShellStatus.Exited })
