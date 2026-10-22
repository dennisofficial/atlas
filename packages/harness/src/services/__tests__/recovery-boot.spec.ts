import { describe, expect, it } from 'bun:test'

import {
  EServiceStatus,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { bootId } from '../boot'
import { ServiceRecovery } from '../recovery'
import { MemoryLog, SequenceIds } from './recovery-fixture'

const thread = toThreadId('thread-1')

const startedDraft = (args: {
  serviceId: string
  command: string
  bootId?: string | undefined
}): EventDraft => ({
  type: 'service-started',
  serviceId: args.serviceId,
  command: args.command,
  bootId: args.bootId,
})

const endedCount = (log: MemoryLog): number =>
  log.stored.filter((event) => event.type === 'service-ended').length

describe('ServiceRecovery against services this boot still owns', () => {
  it('leaves this boot’s open starts alone: a live service, or an ending this boot wrote but has not delivered', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId })],
    })

    const live = new ServiceRecovery({ log, ids })
    const settledLive = await live.recordLost({ threadId: thread })

    const endedAndUndelivered = new ServiceRecovery({ log, ids })
    const settledEnding = await endedAndUndelivered.recordLost({ threadId: thread })

    expect(settledLive).toEqual([])
    expect(settledEnding).toEqual([])
    expect(endedCount(log)).toBe(0)
  })

  it('still settles a previous boot’s start that shares the serviceId', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'last boot', bootId: 'boot-before' }),
        startedDraft({ serviceId: 'svc_1', command: 'this boot', bootId }),
      ],
    })

    const settled = await new ServiceRecovery({ log, ids }).recordLost({ threadId: thread })

    expect(settled).toEqual([{ serviceId: 'svc_1', command: 'last boot', description: undefined }])
  })

  it('leaves an undated start alone while the live registry still holds the service', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'predates bootId' })],
    })

    const live = new ServiceRecovery({
      log,
      ids,
      live: () => [{ serviceId: 'svc_1' }],
    })
    const settled = await live.recordLost({ threadId: thread })

    expect(settled).toEqual([])
    expect(endedCount(log)).toBe(0)
  })

  it('settles a dated previous-boot start even when a live service reuses its id', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'last boot', bootId: 'boot-before' })],
    })

    const live = new ServiceRecovery({
      log,
      ids,
      live: () => [{ serviceId: 'svc_1' }],
    })
    const settled = await live.recordLost({ threadId: thread })

    expect(settled).toEqual([{ serviceId: 'svc_1', command: 'last boot', description: undefined }])
    expect(endedCount(log)).toBe(1)
  })

  it('counts an undated start as lost once no live registry can vouch for it', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'predates bootId' })],
    })

    const gone = new ServiceRecovery({
      log,
      ids,
      live: () => [{ serviceId: 'svc_9' }],
    })
    const settled = await gone.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { serviceId: 'svc_1', command: 'predates bootId', description: undefined },
    ])
    const ending = log.stored.at(-1)
    if (ending?.type !== 'service-ended') throw new Error('expected an ending')
    expect(ending.status).toBe(EServiceStatus.Killed)
  })
})

describe('ServiceRecovery retries what it could not write', () => {
  it('marks a thread reconciled only after the append lands, so a failed append is tried again', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })
    const recovery = new ServiceRecovery({ log, ids })
    log.failAppends = 1

    await expect(recovery.recordLost({ threadId: thread })).rejects.toThrow('append failed')
    const retried = await recovery.recordLost({ threadId: thread })

    expect(retried).toEqual([
      { serviceId: 'svc_1', command: 'bun run dev', description: undefined },
    ])
    expect(endedCount(log)).toBe(1)
  })

  it('retries a failed read the same way', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })
    const recovery = new ServiceRecovery({ log, ids })
    log.failReads = 1

    await expect(recovery.recordLost({ threadId: thread })).rejects.toThrow('read failed')
    const retried = await recovery.recordLost({ threadId: thread })

    expect(retried).toHaveLength(1)
    expect(endedCount(log)).toBe(1)
  })
})

describe('ServiceRecovery under concurrent calls', () => {
  it('joins the calls racing one thread into a single settlement', async () => {
    const ids = new SequenceIds()
    const log = new MemoryLog(ids)
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })
    const recovery = new ServiceRecovery({ log, ids })

    const [first, second] = await Promise.all([
      recovery.recordLost({ threadId: thread }),
      recovery.recordLost({ threadId: thread }),
    ])

    expect(first).toEqual([{ serviceId: 'svc_1', command: 'bun run dev', description: undefined }])
    expect(second).toEqual(first)
    expect(endedCount(log)).toBe(1)
  })
})
