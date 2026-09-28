import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EShellStatus,
  EventLogPort,
  stampDrafts,
  toEventId,
  toRunId,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type ThreadId,
} from '@dltech/atlas-core'

import { RandomIds } from '../../store/ids'
import {
  announced,
  closeRegistries,
  endedDraft,
  job,
  openRegistry,
  printed,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

class RecordingLog extends EventLogPort {
  readonly appended: EventDraft[] = []
  private readonly stored: Event[] = []
  private seq = 0

  async append(args: { threadId: ThreadId; drafts: readonly EventDraft[] }): Promise<Event[]> {
    this.appended.push(...args.drafts)
    const envelopes: EventEnvelope[] = args.drafts.map(() => {
      this.seq += 1
      return {
        id: toEventId(`event-${this.seq}`),
        seq: this.seq,
        threadId: args.threadId,
        runId: toRunId(`run-${this.seq}`),
        depth: 0,
        at: '2026-09-26T00:00:00.000Z',
      }
    })
    const stamped = stampDrafts({ drafts: [...args.drafts], envelopes })
    this.stored.push(...stamped)
    return stamped
  }

  async read(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.stored.filter((event) => event.threadId === args.threadId)
  }

  async readOwn(args: { threadId: ThreadId }): Promise<Event[]> {
    return this.read(args)
  }

  async head(): Promise<number> {
    return this.seq
  }

  async replace(): Promise<Event[]> {
    return []
  }
}

const recordIn = (log: RecordingLog, registry: { recordEndings: Function }, threadId: ThreadId = THREAD) =>
  registry.recordEndings({ log, ids: new RandomIds(), threadId })

const settledShellLog = async (
  log: RecordingLog,
  shells: readonly { shellId: string; command: string }[],
  threadId: ThreadId = THREAD,
): Promise<void> => {
  const drafts: EventDraft[] = shells.flatMap(({ shellId, command }) => [
    {
      type: 'background-shell-started' as const,
      shellId,
      command,
    },
    {
      type: 'background-shell-ended' as const,
      shellId,
      command,
      status: EShellStatus.Exited,
      exitCode: 0,
      output: '',
      droppedCharacters: 0,
      remainingCharacters: 0,
    },
  ])
  await log.append({ threadId, drafts })
}

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('recording endings the notice queue never made durable', () => {
      it('writes an ending for a shell the model killed, so the next boot settles nothing', async () => {
        const { registry } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo before; sleep 60' }))
        if (!started.ok) throw new Error(started.reason)
        await printed({ registry, shellId: started.snapshot.shellId, text: 'before' })

        const killed = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!killed.ok || killed.settled === undefined) throw new Error('the kill was not claimed')
        await killed.settled

        const log = new RecordingLog()
        const recorded = await recordIn(log, registry)

        expect(recorded).toHaveLength(1)
        expect(endedDraft(log.appended[0])).toMatchObject({
          shellId: started.snapshot.shellId,
          killedBy: EKilledBy.Model,
          output: '',
        })
      })

      it('leaves a shell whose ending the queue already carries to the drain, writing nothing twice', async () => {
        const { registry } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })

        const log = new RecordingLog()
        const recorded = await recordIn(log, registry)

        expect(recorded).toEqual([])
        expect(log.appended).toEqual([])
      })

      it('answers only the threads still holding an unresolved ending', async () => {
        const { registry } = openRegistry({ adapter })
        const claimed = registry.start(job({ command: 'sleep 60' }))
        if (!claimed.ok) throw new Error(claimed.reason)
        registry.kill({ shellId: claimed.snapshot.shellId, by: EKilledBy.Model, threadId: THREAD })
        await settle({ registry, shellId: claimed.snapshot.shellId })

        const plain = registry.start(job({ command: 'echo settled' }))
        if (!plain.ok) throw new Error(plain.reason)
        await settle({ registry, shellId: plain.snapshot.shellId })

        expect(registry.threadsWithUnresolvedEndings()).toEqual([THREAD])
      })

      it('stops claiming a thread once its endings are recorded', async () => {
        const { registry } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)
        registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.Model, threadId: THREAD })
        await settle({ registry, shellId: started.snapshot.shellId })

        await recordIn(new RecordingLog(), registry)

        expect(registry.threadsWithUnresolvedEndings()).toEqual([])
      })

      it('writes no second ending for a shell the log already shows started and ended', async () => {
        const { registry } = openRegistry({ adapter })
        const log = new RecordingLog()
        await settledShellLog(log, [{ shellId: 'bash_1', command: 'echo settled' }])

        const recorded = await recordIn(log, registry)

        expect(recorded).toEqual([])
        expect(registry.threadsWithUnresolvedEndings()).toEqual([])
      })

      it('does not claim a thread whose shells are all settled in the log', async () => {
        const { registry } = openRegistry({ adapter })
        const log = new RecordingLog()
        await settledShellLog(log, [
          { shellId: 'bash_1', command: 'echo one' },
          { shellId: 'bash_2', command: 'echo two' },
        ])

        await recordIn(log, registry)

        expect(registry.threadsWithUnresolvedEndings()).toEqual([])
      })

      it('settles a still-running shell whose start never made the log, as unrecorded', async () => {
        const { registry } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        const log = new RecordingLog()
        const recorded = await recordIn(log, registry)

        expect(recorded).toHaveLength(1)
        expect(endedDraft(log.appended[0])).toMatchObject({
          shellId: started.snapshot.shellId,
          killedBy: EKilledBy.Unrecorded,
        })
      })

      it('writes nothing for a shell whose ending a turn already drained into the log', async () => {
        const { registry } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo done' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await announced({ registry })

        const log = new RecordingLog()
        // A turn drains the notice and appends the real ending, exactly as run-turn does.
        const drafts = registry.drainNotifications({ threadId: THREAD })
        await log.append({ threadId: THREAD, drafts })

        // Teardown must not re-record what the log already settled.
        const recorded = await recordIn(log, registry)

        expect(recorded).toEqual([])
        expect(log.appended.filter((d) => d.type === 'background-shell-ended')).toHaveLength(1)
      })

      it('records nothing on a second pass once a drained shell is settled in the log', async () => {
        const { registry } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo done' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await announced({ registry })

        const log = new RecordingLog()
        await log.append({ threadId: THREAD, drafts: registry.drainNotifications({ threadId: THREAD }) })

        // recordEndings may still be handed the thread, but it must settle nothing.
        const recorded = await recordIn(log, registry)
        expect(recorded).toEqual([])
        expect(log.appended.filter((d) => d.type === 'background-shell-ended')).toHaveLength(1)
      })
    })
  })
}
