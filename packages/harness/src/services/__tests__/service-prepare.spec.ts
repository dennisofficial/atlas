import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId, type ClockPort, type ThreadId } from '@dltech/atlas-core'

import { LocalProcessPort } from '../../execution/local-process'
import { BunServiceRegistry } from '../service-registry'

const THREAD = toThreadId('thread-under-test')
const ELSEWHERE = toThreadId('thread-next-door')

class SteppableClock implements ClockPort {
  private millis = Date.parse('2026-09-02T12:00:00.000Z')

  now(): string {
    return new Date(this.millis).toISOString()
  }
}

const opened: { registry: BunServiceRegistry; root: string }[] = []

function openRegistry(): { registry: BunServiceRegistry } {
  const root = mkdtempSync(join(tmpdir(), 'atlas-services-'))
  const registry = new BunServiceRegistry({
    root,
    clock: new SteppableClock(),
    logsDirectory: join(root, 'logs'),
    processes: new LocalProcessPort(),
  })
  opened.push({ registry, root })
  return { registry }
}

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.registry.closeAll()
    rmSync(entry.root, { recursive: true, force: true })
  }
})

async function startEnded({
  registry,
  threadId = THREAD,
  command = 'echo service-out',
}: {
  registry: BunServiceRegistry
  threadId?: ThreadId
  command?: string
}): Promise<string> {
  const started = await registry.start({ threadId, command, description: 'a service' })
  if (!started.ok) throw new Error(started.reason)
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (registry.pendingNotices({ threadId }).length > 0) return started.snapshot.serviceId
    await Bun.sleep(25)
  }
  throw new Error('the service ending was never announced')
}

describe('preparing service notices without acknowledging', () => {
  it('prepares twice before acknowledging: a failed append loses nothing', async () => {
    const { registry } = openRegistry()
    await startEnded({ registry })

    const first = registry.prepareNotifications({ threadId: THREAD })
    const second = registry.prepareNotifications({ threadId: THREAD })

    expect(first.drafts).toHaveLength(1)
    expect(second.drafts).toHaveLength(1)
    expect(second.drafts[0]?.type).toBe('service-ended')
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)

    first.acknowledge()
    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
    expect(registry.prepareNotifications({ threadId: THREAD }).drafts).toEqual([])
  })

  it('acknowledges exactly once: a second ack removes nothing more', async () => {
    const { registry } = openRegistry()
    await startEnded({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    await startEnded({ registry, command: 'echo second-service' })

    batch.acknowledge()
    batch.acknowledge()

    const remaining = registry.prepareNotifications({ threadId: THREAD })
    expect(remaining.drafts).toHaveLength(1)
  })

  it('leaves a notice that arrived while the batch was being prepared, and only that one', async () => {
    const { registry } = openRegistry()
    await startEnded({ registry })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    const late = await startEnded({ registry, command: 'echo late-service' })

    batch.acknowledge()

    const remaining = registry.prepareNotifications({ threadId: THREAD })
    expect(remaining.drafts).toHaveLength(1)
    const draft = remaining.drafts[0]
    expect(draft?.type === 'service-ended' ? draft.serviceId : undefined).toBe(late)
  })

  it('enumerates a thread with a queued ending until the batch is acknowledged', async () => {
    const { registry } = openRegistry()
    await startEnded({ registry })

    expect(registry.threadsWithPendingInput()).toEqual([THREAD])

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(registry.threadsWithPendingInput()).toEqual([THREAD])

    batch.acknowledge()
    expect(registry.threadsWithPendingInput()).toEqual([])
  })

  it('scopes the batch to its thread: a neighbour keeps its own ending', async () => {
    const { registry } = openRegistry()
    await startEnded({ registry })
    await startEnded({ registry, threadId: ELSEWHERE, command: 'echo elsewhere' })

    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.drafts).toHaveLength(1)
    batch.acknowledge()

    expect(registry.threadsWithPendingInput()).toEqual([ELSEWHERE])
    expect(registry.prepareNotifications({ threadId: ELSEWHERE }).drafts).toHaveLength(1)
  })

  it('drains as before: prepare plus an immediate acknowledgment', async () => {
    const { registry } = openRegistry()
    await startEnded({ registry })

    const drained = registry.drainNotifications({ threadId: THREAD })
    expect(drained).toHaveLength(1)
    expect(drained[0]?.type).toBe('service-ended')
    expect(registry.drainNotifications({ threadId: THREAD })).toEqual([])
  })
})
