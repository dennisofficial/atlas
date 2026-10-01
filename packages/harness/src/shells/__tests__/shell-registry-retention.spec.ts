import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, type ThreadId } from '@dltech/atlas-core'

import type { ShellId } from '../shell-id'
import { RETAINED_ENDED_SHELLS, type ShellRegistryPort } from '../shell-registry'
import {
  closeRegistries,
  ELSEWHERE,
  job,
  openRegistry,
  recorded,
  settle,
  THREAD,
} from './shell-registry-fixture'

afterEach(closeRegistries)

const CHURN = 5

async function churnEndedShells({
  registry,
  threadId,
  count,
}: {
  registry: ShellRegistryPort
  threadId: ThreadId
  count: number
}): Promise<ShellId[]> {
  const shellIds: ShellId[] = []
  for (let index = 0; index < count; index += 1) {
    const started = registry.start(job({ command: 'true', threadId }))
    if (!started.ok) throw new Error(started.reason)
    shellIds.push(started.snapshot.shellId)
    await settle({ registry, shellId: started.snapshot.shellId, threadId })
  }
  return shellIds
}

describe('bounding what the registry retains', () => {
  it('drops ended shells past the retention cap, keeping the most recent', async () => {
    const { registry, log } = openRegistry()
    const shellIds = await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })
    await recorded({ log, count: RETAINED_ENDED_SHELLS + CHURN })

    const kept = registry.listEverywhere().map((snapshot) => snapshot.shellId)
    expect(kept).toHaveLength(RETAINED_ENDED_SHELLS)
    expect(kept).toEqual(shellIds.slice(CHURN))
  })

  it('never reaps a live shell while ended ones are churned out', async () => {
    const { registry, log } = openRegistry()
    const first = registry.start(job({ command: 'sleep 300' }))
    if (!first.ok) throw new Error(first.reason)
    const second = registry.start(job({ command: 'sleep 300' }))
    if (!second.ok) throw new Error(second.reason)

    await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })
    await recorded({ log, count: RETAINED_ENDED_SHELLS + CHURN })

    const kept = registry.listEverywhere().map((snapshot) => snapshot.shellId)
    expect(kept).toHaveLength(RETAINED_ENDED_SHELLS + 2)
    expect(kept).toContain(first.snapshot.shellId)
    expect(kept).toContain(second.snapshot.shellId)

    const read = registry.read({ shellId: first.snapshot.shellId, threadId: THREAD })
    expect(read.ok).toBe(true)
  })

  it('lets an ended shell of another thread churn out with the rest, its ending already durable', async () => {
    const { registry, log } = openRegistry()
    const kept = registry.start(job({ command: 'echo not-yet-told', threadId: ELSEWHERE }))
    if (!kept.ok) throw new Error(kept.reason)
    await settle({ registry, shellId: kept.snapshot.shellId, threadId: ELSEWHERE })
    await recorded({ log, threadId: ELSEWHERE })

    await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })
    await recorded({ log, threadId: THREAD, count: RETAINED_ENDED_SHELLS + CHURN })

    // Reaping holds no output hostage: the ending is already in the log, so the oldest ended
    // shells leave the registry whether or not anyone has read them.
    expect(registry.listEverywhere()).toHaveLength(RETAINED_ENDED_SHELLS)
    expect(
      registry
        .listEverywhere()
        .some((snapshot) => snapshot.shellId === kept.snapshot.shellId),
    ).toBe(false)

    const ended = (log?.appended ?? []).find(
      (draft) => draft.type === 'background-shell-ended' && draft.shellId === kept.snapshot.shellId,
    )
    expect(ended).toMatchObject({ output: 'not-yet-told\n' })
  })

  it('leaves a reaped shell answering as its final snapshot, with no output behind it', async () => {
    const { registry, log } = openRegistry()
    const started = registry.start(job({ command: 'echo delivered' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })

    const listed = registry
      .list({ threadId: THREAD })
      .find((snapshot) => snapshot.shellId === started.snapshot.shellId)
    expect(listed).toMatchObject({
      status: EShellStatus.Exited,
      exitCode: 0,
      totalCharacters: 'delivered\n'.length,
    })

    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('delivered\n')
    expect(read.ok && read.delta.remainingCharacters).toBe(0)

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.Model,
      threadId: THREAD,
    })
    expect(killed.ok && killed.snapshot.status).toBe(EShellStatus.Exited)
  })
})
