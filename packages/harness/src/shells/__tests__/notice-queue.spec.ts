import { describe, expect, it } from 'bun:test'

import { EShellStatus, toThreadId } from '@dltech/atlas-core'

import type { ShellDelta, ShellSnapshot } from '../background-shell'
import { ENotice, ShellNoticeQueue } from '../notice-queue'
import { toShellId } from '../shell-id'

const THREAD = toThreadId('thread-under-test')

const endedSnapshot = (args: { shellId: string }): ShellSnapshot => ({
  shellId: toShellId(args.shellId),
  threadId: THREAD,
  command: 'echo done',
  description: 'Finish a job',
  status: EShellStatus.Exited,
  exitCode: 0,
  startedAt: '2026-08-27T12:00:00.000Z',
  lastOutputAt: '2026-08-27T12:00:01.000Z',
  endedAt: '2026-08-27T12:00:01.000Z',
  totalCharacters: 5,
  awaitingInput: false,
})

const deltaOf = (text: string): ShellDelta => ({
  text,
  droppedCharacters: 0,
  remainingCharacters: 0,
})

describe('preparing a batch off the shell notice queue', () => {
  it('wakes the turn for an ended bell that carries no draft', () => {
    const queue = new ShellNoticeQueue(() => endedSnapshot({ shellId: 'bash_1' }))
    queue.queue({ kind: ENotice.Ended, snapshot: endedSnapshot({ shellId: 'bash_1' }), threadId: THREAD })

    const batch = queue.prepare({ threadId: THREAD })

    expect(batch.drafts).toEqual([])
    expect(batch.wakesTurn).toBe(true)
    batch.acknowledge()
    expect(queue.pending({ threadId: THREAD })).toEqual([])
  })

  it('takes a prompt delta exactly once while preparing it', () => {
    const queue = new ShellNoticeQueue(() => undefined)
    let taken = 0
    queue.queue({
      kind: ENotice.AwaitingInput,
      snapshot: endedSnapshot({ shellId: 'bash_1' }),
      threadId: THREAD,
      take: () => {
        taken += 1
        return deltaOf('partial prompt')
      },
    })

    const batch = queue.prepare({ threadId: THREAD })

    expect(taken).toBe(1)
    expect(batch.drafts).toHaveLength(1)
    expect(batch.wakesTurn).toBe(true)
  })
})
