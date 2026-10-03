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

const RETENTION_CHURN_TIMEOUT_MS = 30_000
const CHURN = 5

afterEach(closeRegistries, RETENTION_CHURN_TIMEOUT_MS)

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
    const started = await registry.start(job({ command: 'true', threadId }))
    if (!started.ok) throw new Error(started.reason)
    shellIds.push(started.snapshot.shellId)
    await settle({ registry, shellId: started.snapshot.shellId, threadId })
  }
  return shellIds
}

describe('bounding what the registry retains', async () => {
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
  }, RETENTION_CHURN_TIMEOUT_MS)

  it('never reaps a live shell while ended ones are churned out', async () => {
    const { registry, log } = openRegistry()
    const first = await registry.start(job({ command: 'sleep 300' }))
    if (!first.ok) throw new Error(first.reason)
    const second = await registry.start(job({ command: 'sleep 300' }))
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

    const read = await registry.read({ shellId: first.snapshot.shellId, threadId: THREAD })
    expect(read.ok).toBe(true)
  }, RETENTION_CHURN_TIMEOUT_MS)

  it('lets an ended shell of another thread churn out with the rest, its ending already durable', async () => {
    const { registry, log } = openRegistry()
    const kept = await registry.start(job({ command: 'echo not-yet-told', threadId: ELSEWHERE }))
    if (!kept.ok) throw new Error(kept.reason)
    await settle({ registry, shellId: kept.snapshot.shellId, threadId: ELSEWHERE })
    await recorded({ log, threadId: ELSEWHERE })

    await churnEndedShells({
      registry,
      threadId: THREAD,
      count: RETAINED_ENDED_SHELLS + CHURN,
    })
    await recorded({ log, threadId: THREAD, count: RETAINED_ENDED_SHELLS + CHURN })

    expect(registry.listEverywhere()).toHaveLength(RETAINED_ENDED_SHELLS)
    expect(
      registry
        .listEverywhere()
        .some((snapshot) => snapshot.shellId === kept.snapshot.shellId),
    ).toBe(false)

    const ended = (log?.appended ?? []).find(
      (draft) => draft.type === 'background-shell-ended' && draft.shellId === kept.snapshot.shellId,
    )
    expect(ended).toMatchObject({ output: 'not-yet-told\n', outputPath: kept.snapshot.outputPath })
    if (kept.snapshot.outputPath === undefined) throw new Error('the shell must name its spool')
    expect(await Bun.file(kept.snapshot.outputPath).text()).toBe('not-yet-told\n')
    const read = await registry.read({ shellId: kept.snapshot.shellId, threadId: ELSEWHERE })
    expect(read.ok).toBe(false)
    expect((await Bun.file(kept.snapshot.outputPath).text()).match(/^not-yet-told$/gm)).toEqual(['not-yet-told'])
  }, RETENTION_CHURN_TIMEOUT_MS)

  it('retains an ended handle below capacity and preserves its spool after repeated reads', async () => {
    const { registry, log } = openRegistry()
    const started = await registry.start(job({ command: 'echo delivered' }))
    if (!started.ok) throw new Error(started.reason)
    await settle({ registry, shellId: started.snapshot.shellId })
    await recorded({ log })

    const listed = registry
      .list({ threadId: THREAD })
      .find((snapshot) => snapshot.shellId === started.snapshot.shellId)
    expect(listed).toMatchObject({
      status: EShellStatus.Exited,
      exitCode: 0,
    })

    const read = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(read.ok && read.delta.text).toBe('delivered\n')
    expect(read.ok && read.delta.remainingCharacters).toBe(0)
    const second = await registry.read({ shellId: started.snapshot.shellId, threadId: THREAD })
    expect(second.ok && second.delta.text).toBe('')
    expect(registry.list({ threadId: THREAD }).map((snapshot) => snapshot.shellId)).toContain(started.snapshot.shellId)
    if (started.snapshot.outputPath === undefined) throw new Error('the shell must name its spool')
    expect(await Bun.file(started.snapshot.outputPath).text()).toBe('delivered\n')

    const killed = registry.kill({
      shellId: started.snapshot.shellId,
      by: EKilledBy.Model,
      threadId: THREAD,
    })
    expect(killed.ok && killed.snapshot.status).toBe(EShellStatus.Exited)
    expect(listed?.totalCharacters).toBe('delivered\n'.length)
  })
})
