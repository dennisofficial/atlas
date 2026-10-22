import { afterEach, describe, expect, it } from 'bun:test'

import {
  AfterShellHook,
  EKilledBy,
  ELogSeverity,
  EStage,
  type AfterShell,
  type HookOrder,
} from '@dltech/atlas-core'

import { HookChain, type HookChainSource } from '../../hooks/registry'

import {
  announced,
  closeRegistries,
  ELSEWHERE,
  endedDraft,
  endedInLog,
  job,
  openRegistry,
  printed,
  recorded,
  RecordingOperations,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('the wake bell a durable ending rings', async () => {
      it('rings once the ending is durable, without a second announcement', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })
        await announced({ registry })

        expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
        expect(endedInLog(log)).toHaveLength(1)
      })

      it('fires onNotice only after the append, never before it', async () => {
        const { registry, log } = openRegistry({ adapter })
        if (log === undefined) throw new Error('expected a recording log')
        let appendOpen = false
        let rangDuringAppend = false
        let rings = 0
        registry.onNotice(() => {
          rings += 1
          if (appendOpen) rangDuringAppend = true
        })
        const appending = new Promise<void>((resolve) => {
          setTimeout(resolve, 150)
        })
        log.appending = async () => {
          appendOpen = true
          await appending
          appendOpen = false
        }

        const started = await registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })
        await announced({ registry })

        expect(rangDuringAppend).toBe(false)
        expect(rings).toBe(1)
        expect(endedInLog(log)).toHaveLength(1)
      })

      it('prepares drafts[] with wakesTurn true, and the ack removes exactly the captured bell', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo hi' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })
        await announced({ registry })

        const batch = registry.prepareNotifications({ threadId: THREAD })
        expect(batch.drafts).toEqual([])
        expect(batch.wakesTurn).toBe(true)

        batch.acknowledge()
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        expect(endedInLog(log)).toHaveLength(1)
      })

      it('rings for a failed exit, naming the code in the durable record', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'exit 7' }))
        if (!started.ok) throw new Error(started.reason)
        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })
        await announced({ registry })

        expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
        expect(endedDraft(endedInLog(log)[0]).exitCode).toBe(7)
      })

      it('rings for a shell the developer killed', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        registry.kill({ shellId: started.snapshot.shellId, by: EKilledBy.User, threadId: THREAD })
        await recorded({ log })
        await announced({ registry })

        expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
        expect(endedDraft(endedInLog(log)[0]).killedBy).toBe(EKilledBy.User)
      })

      it('rings for a model kill after its settled continuation resolves', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'echo before; sleep 60' }))
        if (!started.ok) throw new Error(started.reason)
        await printed({ registry, shellId: started.snapshot.shellId, text: 'before' })

        const killed = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!killed.ok || killed.settled === undefined) {
          throw new Error('a model kill hands back the settled continuation')
        }
        const ending = await killed.settled
        expect(ending.died).toBe(true)

        await recorded({ log })
        await announced({ registry })
        expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)

        const batch = registry.prepareNotifications({ threadId: THREAD })
        expect(batch.wakesTurn).toBe(true)
        batch.acknowledge()
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
      })

      it('rings for a shell closeAll killed, once the ending is durable', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = await registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        await registry.closeAll()

        expect(endedInLog(log)).toHaveLength(1)
        await announced({ registry })
        expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
      })

      it('rings only for the thread that owns the shell', async () => {
        const { registry, log } = openRegistry({ adapter })
        const theirs = await registry.start(job({ command: 'echo elsewhere', threadId: ELSEWHERE }))
        if (!theirs.ok) throw new Error(theirs.reason)
        await settle({ registry, shellId: theirs.snapshot.shellId, threadId: ELSEWHERE })
        await recorded({ log, threadId: ELSEWHERE })
        await announced({ registry, threadId: ELSEWHERE })

        expect(registry.pendingNotices({ threadId: ELSEWHERE })).toHaveLength(1)
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        expect(registry.threadsAwaitingNotice()).toEqual([ELSEWHERE])
      })

      it('reports a failed append to operations, rings nothing, and stays readable', async () => {
        const operations = new RecordingOperations()
        const { registry, log } = openRegistry({ adapter, operations })
        if (log === undefined) throw new Error('expected a recording log')
        const started = await registry.start(job({ command: 'sleep 0.3; echo kept-despite-the-store' }))
        if (!started.ok) throw new Error(started.reason)
        const opened = Promise.withResolvers<void>()
        log.appending = async () => {
          opened.resolve()
          throw new Error('the store is gone')
        }

        await opened.promise
        await settle({ registry, shellId: started.snapshot.shellId })
        await Bun.sleep(200)

        expect(endedInLog(log)).toEqual([])
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        const warnings = operations.entries.filter(
          (entry) => entry.severity === ELogSeverity.Warn && entry.source === 'shells.journal',
        )
        expect(warnings).toHaveLength(1)
        expect(warnings[0]?.message).toContain('could not record background shell ending')
        expect(warnings[0]?.message).toContain('the store is gone')

        const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
        expect(read.ok && read.delta.text).toBe('kept-despite-the-store\n')

        await registry.closeAll()
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
      })

      it('rings nothing for a shell a rewind cut while its after-shell hooks ran', async () => {
        let releaseHooks = (): void => {}
        const hookGate = new Promise<void>((resolve) => {
          releaseHooks = resolve
        })
        class GatedHook extends AfterShellHook {
          readonly name = 'gated'
          readonly order: HookOrder = { stage: EStage.Observe, nudge: 0 }
          readonly run: AfterShell = async () => {
            await hookGate
            return {}
          }
        }
        const hooks: HookChainSource = () => new HookChain({ afterShell: [new GatedHook()] })
        const { registry, log } = openRegistry({ adapter, hooks })
        const started = await registry.start(job({ command: 'echo done' }))
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await registry.removeShells({
          threadId: THREAD,
          shellIds: [started.snapshot.shellId],
          by: EKilledBy.Rewind,
        })
        releaseHooks()
        await Bun.sleep(300)

        expect(endedInLog(log)).toEqual([])
        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
      })
    })
  })
}
