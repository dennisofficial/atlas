import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  toThreadId,
  type ClockPort,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BunServiceRegistry } from '../service-registry'
import type { Scheduler } from '../service-supervisor'

const THREAD = toThreadId('thread-crash-notices')

const clock: ClockPort = { now: () => '2026-10-29T12:00:00.000Z' }

class FakeProcesses implements ProcessPort {
  spawned = 0
  private readonly ends: ((code: number) => void)[] = []

  spawn(args: SpawnCommand): ProcessHandle {
    void args
    this.spawned += 1
    let end: (code: number) => void = () => undefined
    const exited = new Promise<number>((resolve) => {
      end = resolve
    })
    this.ends.push(end)
    return {
      stdout: new ReadableStream({ start: (controller) => controller.close() }),
      stderr: new ReadableStream({ start: (controller) => controller.close() }),
      exited,
      terminate: () => end(143),
    }
  }

  crash(index: number): void {
    this.ends[index]?.(1)
  }

  which(): string | null {
    return null
  }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const harness = () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-crash-notices-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const processes = new FakeProcesses()
  const timers: (() => void)[] = []
  const scheduler: Scheduler = ({ run }) => {
    timers.push(run)
    return () => undefined
  }
  const registry = new BunServiceRegistry({
    root,
    clock,
    logsDirectory: join(root, 'logs'),
    processes,
    scheduler,
  })
  return { registry, processes, timers }
}

const flush = () => Bun.sleep(10)

const startNamed = (registry: BunServiceRegistry) =>
  registry.start({
    threadId: THREAD,
    name: 'web',
    port: 24001,
    command: 'serve',
    description: 'web',
  })

describe('crash notices while a restart is pending', () => {
  it('queues no notice and lets the registry settle', async () => {
    const { registry, processes } = harness()
    await startNamed(registry)

    processes.crash(0)
    await flush()

    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(0)
    expect(registry.settling()).toBe(false)
    expect(registry.drainNotifications({ threadId: THREAD })).toHaveLength(0)
  })

  it('queues exactly one notice when it gives up, with the crash-loop line in the tail', async () => {
    const { registry, processes, timers } = harness()
    await startNamed(registry)

    for (let crash = 0; crash < 6; crash += 1) {
      processes.crash(crash)
      await flush()
      if (crash < 5) {
        timers.at(-1)?.()
        await flush()
      }
    }

    const drafts = registry.drainNotifications({ threadId: THREAD })
    expect(drafts).toHaveLength(1)
    expect(JSON.stringify(drafts[0])).toContain('crash-looping')
  })

  it('still notifies for a stop by the model', async () => {
    const { registry } = harness()
    const started = await startNamed(registry)
    if (!started.ok) throw new Error(started.reason)

    registry.stop({ serviceId: started.snapshot.serviceId, by: EKilledBy.Model })
    await flush()

    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
  })

  it('still notifies when supervision is suspended', async () => {
    const { registry, processes } = harness()
    await startNamed(registry)

    registry.suspendSupervision()
    processes.crash(0)
    await flush()

    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
  })
})
