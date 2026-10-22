import { describe, expect, it } from 'bun:test'

import {
  EShellStatus,
  toThreadId,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { bootId } from '../boot'
import { ShellRecovery } from '../recovery'
import { MemoryLog, SequenceIds } from './shell-recovery-fixture'

const thread = toThreadId('thread-1')

const startedDraft = (args: {
  shellId: string
  command: string
  bootId?: string | undefined
}): EventDraft => ({
  type: 'background-shell-started',
  shellId: args.shellId,
  command: args.command,
  bootId: args.bootId,
})

const endedCount = (log: MemoryLog): number =>
  log.stored.filter((event) => event.type === 'background-shell-ended').length

describe('ShellRecovery against shells this boot still owns', () => {
  it('leaves this boot’s open starts alone: a live shell, or an ending this boot wrote but has not delivered', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test', bootId })],
    })

    const live = new ShellRecovery({ log, ids })
    const settledLive = await live.recordLost({ threadId: thread })

    const endedAndUndelivered = new ShellRecovery({ log, ids })
    const settledEnding = await endedAndUndelivered.recordLost({ threadId: thread })

    expect(settledLive).toEqual([])
    expect(settledEnding).toEqual([])
    expect(endedCount(log)).toBe(0)
  })

  it('still settles a previous boot’s start that shares the shellId', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ shellId: 'bash_1', command: 'last boot', bootId: 'boot-before' }),
        startedDraft({ shellId: 'bash_1', command: 'this boot', bootId }),
      ],
    })

    const settled = await new ShellRecovery({ log, ids }).recordLost({ threadId: thread })

    expect(settled).toEqual([{ shellId: 'bash_1', command: 'last boot', description: undefined }])
  })

  it('leaves an undated start alone while the live registry still holds the shell', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'predates bootId' })],
    })

    const live = new ShellRecovery({
      log,
      ids,
      live: () => [{ shellId: 'bash_1', threadId: thread }],
    })
    const settled = await live.recordLost({ threadId: thread })

    expect(settled).toEqual([])
    expect(endedCount(log)).toBe(0)
  })

  it('settles a dated previous-boot start even when a live shell reuses its id', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'last boot', bootId: 'boot-before' })],
    })

    const live = new ShellRecovery({
      log,
      ids,
      live: () => [{ shellId: 'bash_1', threadId: thread }],
    })
    const settled = await live.recordLost({ threadId: thread })

    expect(settled).toEqual([{ shellId: 'bash_1', command: 'last boot', description: undefined }])
    expect(endedCount(log)).toBe(1)
  })

  it('counts an undated start as lost once no live registry can vouch for it', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'predates bootId' })],
    })

    const gone = new ShellRecovery({
      log,
      ids,
      live: () => [{ shellId: 'bash_9', threadId: thread }],
    })
    const settled = await gone.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { shellId: 'bash_1', command: 'predates bootId', description: undefined },
    ])
    const ending = log.stored.at(-1)
    if (ending?.type !== 'background-shell-ended') throw new Error('expected an ending')
    expect(ending.status).toBe(EShellStatus.Killed)
  })
})

describe('ShellRecovery retries what it could not write', () => {
  it('marks a thread reconciled only after the append lands, so a failed append is tried again', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' })],
    })
    const recovery = new ShellRecovery({ log, ids })
    log.failAppends = 1

    await expect(recovery.recordLost({ threadId: thread })).rejects.toThrow('append failed')
    const retried = await recovery.recordLost({ threadId: thread })

    expect(retried).toEqual([{ shellId: 'bash_1', command: 'bun test', description: undefined }])
    expect(endedCount(log)).toBe(1)
  })

  it('retries a failed read the same way', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' })],
    })
    const recovery = new ShellRecovery({ log, ids })
    log.failReads = 1

    await expect(recovery.recordLost({ threadId: thread })).rejects.toThrow('read failed')
    const retried = await recovery.recordLost({ threadId: thread })

    expect(retried).toHaveLength(1)
    expect(endedCount(log)).toBe(1)
  })
})

describe('ShellRecovery under concurrent calls', () => {
  it('joins the calls racing one thread into a single settlement', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'bun test' })],
    })
    const recovery = new ShellRecovery({ log, ids })

    const [first, second] = await Promise.all([
      recovery.recordLost({ threadId: thread }),
      recovery.recordLost({ threadId: thread }),
    ])

    expect(first).toEqual([{ shellId: 'bash_1', command: 'bun test', description: undefined }])
    expect(second).toEqual(first)
    expect(endedCount(log)).toBe(1)
  })

  it('settles different threads independently', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    const other: ThreadId = toThreadId('thread-2')
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_1', command: 'one' })],
    })
    await log.append({
      threadId: other,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ shellId: 'bash_2', command: 'two' })],
    })
    const recovery = new ShellRecovery({ log, ids })

    const [first, second] = await Promise.all([
      recovery.recordLost({ threadId: thread }),
      recovery.recordLost({ threadId: other }),
    ])

    expect(first.map((shell) => shell.shellId)).toEqual(['bash_1'])
    expect(second.map((shell) => shell.shellId)).toEqual(['bash_2'])
  })
})
