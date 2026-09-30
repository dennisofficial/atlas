import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  toRunId,
  toThreadId,
  type EventDraft,
} from '@dltech/atlas-core'

import { ServiceRecovery } from '../recovery'
import { MemoryLog, SequenceIds } from './recovery-fixture'

const thread = toThreadId('thread-1')

const startedDraft = (args: {
  serviceId: string
  command: string
  description?: string | undefined
  bootId?: string | undefined
}): EventDraft => ({
  type: 'service-started',
  serviceId: args.serviceId,
  command: args.command,
  description: args.description,
  bootId: args.bootId,
})

const endedDraft = (args: {
  serviceId: string
  command: string
  bootId?: string | undefined
}): EventDraft => ({
  type: 'service-ended',
  serviceId: args.serviceId,
  command: args.command,
  bootId: args.bootId,
  status: EServiceStatus.Exited,
  exitCode: 0,
  logPath: '/tmp/svc.log',
  tail: '',
})

const setup = () => {
  const ids = new SequenceIds()
  const log = new MemoryLog(ids)
  const recovery = new ServiceRecovery({ log, ids })
  return { ids, log, recovery }
}

describe('ServiceRecovery.recordLost', () => {
  it('settles a service that started and never ended', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { serviceId: 'svc_1', command: 'bun run dev', description: undefined },
    ])

    const ending = log.stored.at(-1)
    expect(ending?.type).toBe('service-ended')
    if (ending?.type !== 'service-ended') throw new Error('expected an ending')
    expect(ending.serviceId).toBe('svc_1')
    expect(ending.command).toBe('bun run dev')
    expect(ending.bootId).toBe('boot-1')
    expect(ending.status).toBe(EServiceStatus.Killed)
    expect(ending.killedBy).toBe(EKilledBy.Unrecorded)
    expect(ending.tail).toBe('')
    expect(ending.exitCode).toBeUndefined()
  })

  it('leaves a started-and-ended service alone', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' }),
        endedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' }),
      ],
    })

    const before = log.stored.length
    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([])
    expect(log.stored.length).toBe(before)
  })

  it('pairs chronologically when an id is reused within a boot, so only the later start is open', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'first', bootId: 'boot-1' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [endedDraft({ serviceId: 'svc_1', command: 'first', bootId: 'boot-1' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'second', bootId: 'boot-1' })],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([{ serviceId: 'svc_1', command: 'second', description: undefined }])
    const ending = log.stored.at(-1)
    if (ending?.type !== 'service-ended') throw new Error('expected an ending')
    expect(ending.command).toBe('second')
  })

  it('never settles a previous boot’s open start with a new boot’s end', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'crashed boot', bootId: 'boot-1' }),
        startedDraft({ serviceId: 'svc_1', command: 'fresh boot', bootId: 'boot-2' }),
        endedDraft({ serviceId: 'svc_1', command: 'fresh boot', bootId: 'boot-2' }),
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([
      { serviceId: 'svc_1', command: 'crashed boot', description: undefined },
    ])
  })

  it('settles every open start when two services outlived the crash', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        startedDraft({ serviceId: 'svc_1', command: 'one', bootId: 'boot-1' }),
        startedDraft({ serviceId: 'svc_2', command: 'two', bootId: 'boot-1' }),
        endedDraft({ serviceId: 'svc_1', command: 'one', bootId: 'boot-1' }),
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled.map((service) => service.serviceId)).toEqual(['svc_2'])
  })

  it('runs once per thread per process: a second call settles nothing again', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })

    await recovery.recordLost({ threadId: thread })
    const before = log.stored.length
    const again = await recovery.recordLost({ threadId: thread })

    expect(again).toEqual([])
    expect(log.stored.length).toBe(before)
  })

  it('is a no-op for a graceful restart, where teardown already recorded the endings', async () => {
    const { ids, log, recovery } = setup()
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [startedDraft({ serviceId: 'svc_1', command: 'bun run dev', bootId: 'boot-1' })],
    })
    await log.append({
      threadId: thread,
      runId: ids.nextRunId(),
      drafts: [
        {
          type: 'service-ended',
          serviceId: 'svc_1',
          command: 'bun run dev',
          bootId: 'boot-1',
          status: EServiceStatus.Killed,
          killedBy: EKilledBy.SessionEnd,
          logPath: '/tmp/svc.log',
          tail: '',
        },
      ],
    })

    const settled = await recovery.recordLost({ threadId: thread })

    expect(settled).toEqual([])
  })
})
