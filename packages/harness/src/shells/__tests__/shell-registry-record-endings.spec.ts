import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EventLogPort, type Event, type EventDraft, type ThreadId } from '@dltech/atlas-core'

import { RandomIds } from '../../store/ids'
import {
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

  async append(args: { drafts: readonly EventDraft[] }): Promise<Event[]> {
    this.appended.push(...args.drafts)
    return []
  }

  async read(): Promise<Event[]> {
    return []
  }

  async readOwn(): Promise<Event[]> {
    return []
  }

  async head(): Promise<number> {
    return 0
  }

  async replace(): Promise<Event[]> {
    return []
  }
}

const recordIn = (log: RecordingLog, registry: { recordEndings: Function }, threadId: ThreadId = THREAD) =>
  registry.recordEndings({ log, ids: new RandomIds(), threadId })

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
    })
  })
}
