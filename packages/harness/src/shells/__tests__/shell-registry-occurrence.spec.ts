import { afterEach, describe, expect, it } from 'bun:test'

import {
  AfterShellHook,
  EKilledBy,
  EShellStatus,
  EStage,
  type AfterShell,
  type HookOrder,
} from '@dltech/atlas-core'

import { HookChain, type HookChainSource } from '../../hooks/registry'

import {
  closeRegistries,
  endedInLog,
  job,
  openRegistry,
  printed,
  recorded,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('an ending written at occurrence', () => {
      it('writes the whole remaining output into the log the moment the shell settles', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: `printf 'first\\n'; sleep 0.3; printf 'second\\n'` }))
        if (!started.ok) throw new Error(started.reason)
        await printed({ registry, shellId: started.snapshot.shellId, text: 'first' })

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const [ending] = endedInLog(log)
        expect(ending?.output).toContain('first')
        expect(ending?.output).toContain('second')
        expect(ending?.remainingCharacters).toBe(0)
      })

      it('appends the ending and the after-shell drafts in one run', async () => {
        class PollHook extends AfterShellHook {
          readonly name = 'poll-ci'
          readonly order: HookOrder = { stage: EStage.Observe, nudge: 0 }
          readonly run: AfterShell = async () => ({ additionalContext: 'the checks are green' })
        }
        const hooks: HookChainSource = () => new HookChain({ afterShell: [new PollHook()] })
        const { registry, log } = openRegistry({ adapter, hooks })
        const started = registry.start(job({ command: 'echo pushed' }))
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        await recorded({ log })

        const events = (await log?.read({ threadId: THREAD })) ?? []
        expect(events.map((event) => event.type)).toEqual([
          'background-shell-ended',
          'context-loaded',
        ])
        expect(events[0]?.runId).toBe(events[1]?.runId)
      })

      it('the real incident: one shell_kill, one durable ending, and teardown synthesizes nothing', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo before; sleep 60' }))
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
        if (!ending.died) throw new Error('the kill never settled')
        expect(ending.snapshot.exitCode).not.toBe(0)
        expect(ending.delta.text).toContain('before')

        await recorded({ log })

        const ended = endedInLog(log)
        expect(ended).toHaveLength(1)
        expect(ended[0]).toMatchObject({
          shellId: started.snapshot.shellId,
          status: EShellStatus.Killed,
          killedBy: EKilledBy.Model,
          output: 'before\n',
        })

        await registry.closeAll()
        expect(endedInLog(log)).toHaveLength(1)
      })

      it('writes a session-end ending at occurrence for a shell closeAll had to kill', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'echo before-close; sleep 60' }))
        if (!started.ok) throw new Error(started.reason)
        await printed({ registry, shellId: started.snapshot.shellId, text: 'before-close' })

        await registry.closeAll()

        const ended = endedInLog(log)
        expect(ended).toHaveLength(1)
        expect(ended[0]).toMatchObject({
          shellId: started.snapshot.shellId,
          status: EShellStatus.Killed,
          killedBy: EKilledBy.SessionEnd,
        })
        expect(ended[0]?.output).toContain('before-close')
      })

      it('a second model kill of the same shell reads the same single ending', async () => {
        const { registry, log } = openRegistry({ adapter })
        const started = registry.start(job({ command: 'sleep 60' }))
        if (!started.ok) throw new Error(started.reason)

        const first = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        const second = registry.kill({
          shellId: started.snapshot.shellId,
          by: EKilledBy.Model,
          threadId: THREAD,
        })
        if (!first.ok || !second.ok) throw new Error('a kill failed')
        if (first.settled === undefined || second.settled === undefined) {
          throw new Error('the settled continuations went missing')
        }
        await Promise.all([first.settled, second.settled])
        await recorded({ log })

        expect(endedInLog(log)).toHaveLength(1)
      })

      it('writes no ending for a shell a rewind cut while its after-shell hooks ran', async () => {
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
        const started = registry.start(job({ command: 'echo done' }))
        if (!started.ok) throw new Error(started.reason)

        await settle({ registry, shellId: started.snapshot.shellId })
        registry.removeShells({
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
