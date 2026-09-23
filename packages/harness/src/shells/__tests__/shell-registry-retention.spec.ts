import { afterEach, describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, type ThreadId } from '@dltech/atlas-core'

import type { ShellId } from '../shell-id'
import { RETAINED_ENDED_SHELLS, type ShellRegistryPort } from '../shell-registry'
import { announced, closeRegistries, ELSEWHERE, job, openRegistry, settle, THREAD } from './shell-registry-fixture'

afterEach(closeRegistries)

const CHURN = 5

async function allAnnounced({
  registry,
  threadId,
  count,
}: {
  registry: ShellRegistryPort
  threadId: ThreadId
  count: number
}): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (registry.pendingNotices({ threadId }).length >= count) return
    await Bun.sleep(25)
  }
  throw new Error(`only ${registry.pendingNotices({ threadId }).length} of ${count} endings announced`)
}

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
  await allAnnounced({ registry, threadId, count })
  return shellIds
}

describe('bounding what the registry retains', () => {
  it('drops ended and drained shells past the retention cap, keeping the most recent', async () => {
    const { registry } = openRegistry()
    const shellIds = await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })

    registry.drainNotifications({ threadId: THREAD })

    const kept = registry.listEverywhere().map((snapshot) => snapshot.shellId)
    expect(kept).toHaveLength(RETAINED_ENDED_SHELLS)
    expect(kept).toEqual(shellIds.slice(CHURN))
  })

  it('never reaps a live shell while ended ones are churned out', async () => {
    const { registry } = openRegistry()
    const first = registry.start(job({ command: 'sleep 300' }))
    if (!first.ok) throw new Error(first.reason)
    const second = registry.start(job({ command: 'sleep 300' }))
    if (!second.ok) throw new Error(second.reason)

    await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })
    registry.drainNotifications({ threadId: THREAD })

    const kept = registry.listEverywhere().map((snapshot) => snapshot.shellId)
    expect(kept).toHaveLength(RETAINED_ENDED_SHELLS + 2)
    expect(kept).toContain(first.snapshot.shellId)
    expect(kept).toContain(second.snapshot.shellId)

    const read = registry.read({ shellId: first.snapshot.shellId, threadId: THREAD })
    expect(read.ok).toBe(true)
  })

  it('keeps the buffer of an ended shell whose ending was never drained', async () => {
    const { registry } = openRegistry()
    const kept = registry.start(job({ command: 'echo not-yet-told', threadId: ELSEWHERE }))
    if (!kept.ok) throw new Error(kept.reason)
    await settle({ registry, shellId: kept.snapshot.shellId, threadId: ELSEWHERE })
    await announced({ registry, threadId: ELSEWHERE })

    await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })
    registry.drainNotifications({ threadId: THREAD })

    expect(registry.listEverywhere()).toHaveLength(RETAINED_ENDED_SHELLS + 1)
    expect(
      registry.peek({ shellId: kept.snapshot.shellId, characters: 1000, threadId: ELSEWHERE }),
    ).toBe('not-yet-told\n')
  })

  it('leaves a reaped shell answering as its final snapshot, with no output behind it', async () => {
    const { registry } = openRegistry()
    const started = registry.start(job({ command: 'echo delivered' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await announced({ registry })

    registry.drainNotifications({ threadId: THREAD })

    const listed = registry
      .list({ threadId: THREAD })
      .find((snapshot) => snapshot.shellId === started.snapshot.shellId)
    expect(listed).toMatchObject({
      status: EShellStatus.Exited,
      exitCode: 0,
      totalCharacters: 'delivered\n'.length,
    })

    const read = registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('')
    expect(read.ok && read.delta.remainingCharacters).toBe(0)

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.Model,
      threadId: THREAD,
    })
    expect(killed.ok && killed.snapshot.status).toBe(EShellStatus.Exited)
  })
})
