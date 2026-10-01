import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  AfterShellHook,
  EKilledBy,
  EStage,
  type AfterShell,
  type HookOrder,
} from '@dltech/atlas-core'

import { HookChain, type HookChainSource } from '../../hooks/registry'
import {
  closeRegistries,
  job,
  openRegistry,
  settle,
  THREAD,
} from './shell-registry-fixture'

process.env.ATLAS_HOME = join(mkdtempSync(join(tmpdir(), 'atlas-settling-')), '.atlas-home')

afterEach(closeRegistries)

class BlockingHook extends AfterShellHook {
  constructor(
    readonly name: string,
    readonly order: HookOrder,
    readonly run: AfterShell,
  ) {
    super()
  }
}

const blockedAfterShell = (): { hooks: HookChainSource; entered: Promise<void>; release: () => void } => {
  let releaseHook = (): void => undefined
  let announceEntered = (): void => undefined
  const entered = new Promise<void>((resolve) => { announceEntered = resolve })
  const gate = new Promise<void>((resolve) => { releaseHook = resolve })
  const hook = new BlockingHook('blocked', { stage: EStage.Observe, nudge: 0 }, async () => {
    announceEntered()
    await gate
    return {}
  })
  const chain = new HookChain({ afterShell: [hook] })
  return { hooks: () => chain, entered, release: () => releaseHook() }
}

const settlingOf = async ({
  registry,
  wanted,
}: {
  registry: { settling?(): boolean }
  wanted: boolean
}): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (registry.settling?.() === wanted) return
    await Bun.sleep(5)
  }
  throw new Error(`settling never became ${wanted}`)
}

describe('a shell death still settling', () => {
  it('is not settling for a healthy running shell', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error(started.reason)
    expect(registry.settling?.()).toBe(false)
  })

  it('stays settling from the exit through a blocked after-shell hook, until the ending lands', async () => {
    const blocked = blockedAfterShell()
    const { registry, log } = openRegistry({ hooks: blocked.hooks })

    const started = registry.start(job({ command: 'echo done' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await blocked.entered

    expect(registry.settling?.()).toBe(true)
    expect(log?.appended ?? []).toHaveLength(0)

    blocked.release()
    await settlingOf({ registry, wanted: false })
    expect(log?.appended?.some((draft) => draft.type === 'background-shell-ended')).toBe(true)
  })

  it('stays settling for a killed shell that has not been reaped yet', async () => {
    const { registry, log } = openRegistry()
    const started = registry.start(job({ command: 'sleep 30' }))
    if (!started.ok) throw new Error(started.reason)

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.Model,
      threadId: THREAD,
    })
    if (!killed.ok) throw new Error(killed.reason)

    expect(registry.settling?.()).toBe(true)
    await killed.settled
    await settlingOf({ registry, wanted: false })
    expect(log?.appended?.some((draft) => draft.type === 'background-shell-ended')).toBe(true)
  })

  it('announces settled only once the final drain has run', async () => {
    const blocked = blockedAfterShell()
    const { registry } = openRegistry({ hooks: blocked.hooks })
    const announcements: number[] = []
    const unsubscribe = registry.onSettled?.(() => announcements.push(announcements.length))
    if (unsubscribe === undefined) throw new Error('onSettled is optional but must exist here')

    const started = registry.start(job({ command: 'echo done' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await blocked.entered
    expect(announcements).toHaveLength(0)

    blocked.release()
    await settlingOf({ registry, wanted: false })
    expect(announcements).toHaveLength(1)
    unsubscribe()
  })
})
