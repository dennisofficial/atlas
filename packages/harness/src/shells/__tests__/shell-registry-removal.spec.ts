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
  job,
  openRegistry,
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

const startOrThrow = (
  registry: Parameters<typeof settle>[0]['registry'],
  command: string,
  threadId = THREAD,
): ShellId => {
  const started = registry.start(job({ command, threadId }))
  if (!started.ok) throw new Error(started.reason)
  return started.snapshot.shellId
}

for (const adapter of shellAdapters) {
  const describeAdapter = adapter.available ? describe : describe.skip

  describeAdapter(`${adapter.name} process adapter`, () => {
    describe('removing the shells a rewind cut', () => {
      it('kills a running shell, process tree included, and forgets it', async () => {
        const { registry, root } = openRegistry({ adapter })
        const witness = join(root, 'survivor.txt')
        const shellId = startOrThrow(registry, `(sleep 2; echo alive > ${witness}) & wait`)

        registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })

        expect(registry.list({ threadId: THREAD })).toEqual([])
        expect(registry.read({ shellId, threadId: THREAD }).ok).toBe(false)
        await Bun.sleep(2_400)
        expect(await Bun.file(witness).exists()).toBe(false)
      }, 15_000)

      it('announces nothing for a shell it removed — the rewound thread never started it', async () => {
        const { registry } = openRegistry({ adapter })
        const shellId = startOrThrow(registry, 'sleep 60')

        registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })
        await Bun.sleep(500)

        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
      })

      it('drops a queued notice of a removed shell but keeps the notices of the survivors', async () => {
        const { registry } = openRegistry({ adapter })
        const cut = startOrThrow(registry, 'echo cut')
        const kept = startOrThrow(registry, 'echo kept')
        await settle({ registry, shellId: cut })
        await settle({ registry, shellId: kept })
        await announced({ registry })

        registry.removeShells({ threadId: THREAD, shellIds: [cut], by: EKilledBy.Rewind })

        const pending = registry.pendingNotices({ threadId: THREAD })
        expect(pending.map((notice) => notice.snapshot.shellId)).toEqual([kept])
        const drained = registry.drainNotifications({ threadId: THREAD })
        expect(drained.map((draft) => draft.type)).toEqual(['background-shell-ended'])
      })

      it('leaves shells of other threads alone, even asked by id', async () => {
        const { registry } = openRegistry({ adapter })
        const own = startOrThrow(registry, 'sleep 60')
        const foreign = startOrThrow(registry, 'sleep 60', ELSEWHERE)

        registry.removeShells({ threadId: THREAD, shellIds: [own, foreign], by: EKilledBy.Rewind })

        expect(registry.list({ threadId: THREAD })).toEqual([])
        expect(registry.list({ threadId: ELSEWHERE }).map((shell) => shell.shellId)).toEqual([
          foreign,
        ])
      })

      it('bumps the registry version so subscribed sidebars refresh', () => {
        const { registry } = openRegistry({ adapter })
        const shellId = startOrThrow(registry, 'sleep 60')
        const before = registry.version()

        registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })

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
        const { registry } = openRegistry({ adapter, hooks: gatedBy({ entered, hold }) })
        const shellId = startOrThrow(registry, 'echo done')

        await hookEntered
        registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })
        release()
        await Bun.sleep(300)

        expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
        expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
      })

      it('closeAll still waits out the SIGKILL grace for a shell a rewind killed', async () => {
        const { registry, root } = openRegistry({ adapter })
        const witness = join(root, 'outlived.txt')
        const shellId = startOrThrow(registry, `trap '' TERM; (sleep 30; echo alive > ${witness}) & wait`)
        await Bun.sleep(300)

        registry.removeShells({ threadId: THREAD, shellIds: [shellId], by: EKilledBy.Rewind })

        const startedAt = Date.now()
        await registry.closeAll()
        const elapsed = Date.now() - startedAt

        expect(elapsed).toBeGreaterThan(SIGKILL_GRACE_MS - 1_000)
        await Bun.sleep(1_000)
        expect(await Bun.file(witness).exists()).toBe(false)
      }, 30_000)
    })
  })
}
