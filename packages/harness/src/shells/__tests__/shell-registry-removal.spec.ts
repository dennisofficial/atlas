import { afterEach, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import {
  AfterShellHook,
  EKilledBy,
  EStage,
  type AfterShell,
  type HookOrder,
} from '@dltech/atlas-core'

import { HookChain, type HookChainSource } from '../../hooks/registry'
import { SIGKILL_GRACE_MS } from '../shell-process'
import { type ShellId } from '../shell-id'
import {
  announced,
  closeRegistries,
  ELSEWHERE,
  endedDraft,
  job,
  openRegistry,
  recorded,
  settle,
  shellAdapters,
  THREAD,
} from './shell-registry-fixture'

class GatedHook extends AfterShellHook {
  constructor(
    readonly name: string,
    readonly order: HookOrder,
    readonly run: AfterShell,
  ) {
    super()
  }
}

const gatedBy = (gate: { entered: () => void; hold: Promise<void> }): HookChainSource => {
  const chain = new HookChain({
    afterShell: [
      new GatedHook('gated', { stage: EStage.Observe, nudge: 0 }, async () => {
        gate.entered()
        await gate.hold
        return {}
      }),
    ],
  })
  return () => chain
}

afterEach(closeRegistries)

const startOrThrow = async (
  registry: Parameters<typeof settle>[0]['registry'],
  command: string,
  threadId = THREAD,
): Promise<ShellId> => {
  const started = await registry.start(job({ command, threadId }))
  if (!started.ok) throw new Error(started.reason)
  return started.snapshot.shellId
}

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('removing the shells a rewind cut', async () => {
      it('kills a running shell, process tree included, and forgets it', async () => {
        const { registry, root } = openRegistry({ adapter })
        const witness = join(root, 'survivor.txt')
        const shellId = await startOrThrow(registry, `(sleep 2; echo alive > ${witness}) & wait`)

        await registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })

        expect(registry.list({ threadId: THREAD })).toEqual([])
        expect((await registry.read({ shellId, threadId: THREAD })).ok).toBe(false)
        await Bun.sleep(2_400)
        expect(await Bun.file(witness).exists()).toBe(false)
      }, 15_000)

      it('announces nothing for a shell it removed — the rewound thread never started it', async () => {
        const { registry, log } = openRegistry({ adapter })
        const shellId = await startOrThrow(registry, 'sleep 60')

        await registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })
        await Bun.sleep(500)

        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
        expect(log?.appended.filter((draft) => draft.type === 'background-shell-ended')).toEqual([])
      })

      it('records the endings of the survivors and nothing further for the removed shell', async () => {
        const { registry, log } = openRegistry({ adapter })
        const cut = await startOrThrow(registry, 'echo cut')
        const kept = await startOrThrow(registry, 'echo kept')
        await settle({ registry, shellId: cut })
        await settle({ registry, shellId: kept })

        await registry.removeShells({ threadId: THREAD, shellIds: [cut], by: EKilledBy.Rewind })

        // The cut shell's settle continuation may still be running; the survivor's ending lands
        // regardless, and removal queues nothing for the cut one.
        await recorded({ log })
        await announced({ registry })
        const ended = (log?.appended ?? []).filter(
          (draft) => draft.type === 'background-shell-ended',
        )
        expect(ended.map((draft) => endedDraft(draft).shellId)).toContain(kept)
        const pending = registry.pendingNotices({ threadId: THREAD })
        expect(pending).toHaveLength(1)
        expect(pending[0]?.snapshot.shellId).toBe(kept)
      })

      it('leaves shells of other threads alone, even asked by id', async () => {
        const { registry } = openRegistry({ adapter })
        const own = await startOrThrow(registry, 'sleep 60')
        const foreign = await startOrThrow(registry, 'sleep 60', ELSEWHERE)

        await registry.removeShells({ threadId: THREAD, shellIds: [own, foreign], by: EKilledBy.Rewind })

        expect(registry.list({ threadId: THREAD })).toEqual([])
        expect(registry.list({ threadId: ELSEWHERE }).map((shell) => shell.shellId)).toEqual([
          foreign,
        ])
      })

      it('bumps the registry version so subscribed sidebars refresh', async () => {
        const { registry } = openRegistry({ adapter })
        const shellId = await startOrThrow(registry, 'sleep 60')
        const before = registry.version()

        await registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })

        expect(registry.version()).toBeGreaterThan(before)
      })

      it('suppresses an ending whose after-shell hooks were still running when the shell was removed', async () => {
        let entered = (): void => {}
        let release = (): void => {}
        const hookEntered = new Promise<void>((resolve) => {
          entered = resolve
        })
        const hold = new Promise<void>((resolve) => {
          release = resolve
        })
        const { registry, log } = openRegistry({ adapter, hooks: gatedBy({ entered, hold }) })
        const shellId = await startOrThrow(registry, 'echo done')

        await hookEntered
        await registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })
        release()
        await Bun.sleep(300)

        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
        expect(log?.appended.filter((draft) => draft.type === 'background-shell-ended')).toEqual([])
      })

      it('rewind waits for the process group to stop before forgetting the shell', async () => {
        const { registry, root } = openRegistry({ adapter })
        const witness = join(root, 'outlived.txt')
        const shellId = await startOrThrow(registry, `trap '' TERM; (sleep 30; echo alive > ${witness}) & wait`)
        await Bun.sleep(300)

        const startedAt = Date.now()
        await registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })
        const elapsed = Date.now() - startedAt
        await registry.closeAll()

        expect(elapsed).toBeGreaterThan(SIGKILL_GRACE_MS - 1_000)
        await Bun.sleep(1_000)
        expect(await Bun.file(witness).exists()).toBe(false)
      }, 30_000)
    })
  })
}
