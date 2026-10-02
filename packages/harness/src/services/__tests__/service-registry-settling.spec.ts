import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  toThreadId,
  type ClockPort,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { BunServiceRegistry } from '../service-registry'

process.env.ATLAS_HOME = join(mkdtempSync(join(tmpdir(), 'atlas-service-settling-')), '.atlas-home')

const THREAD = toThreadId('thread-under-test')

class SteppableClock implements ClockPort {
  private millis = Date.parse('2026-09-02T12:00:00.000Z')

  now(): string {
    return new Date(this.millis).toISOString()
  }
}

class GatedPort implements ProcessPort {
  private end: (code: number) => void = () => undefined
  readonly closed: Promise<void>

  constructor() {
    this.closed = new Promise<void>((resolve) => {
      this.end = (code) => {
        void code
        resolve()
      }
    })
  }

  spawn(args: SpawnCommand): ProcessHandle {
    void args
    const exited = new Promise<number>((resolve) => {
      const prior = this.end
      this.end = (code) => {
        prior(code)
        resolve(code)
      }
    })
    return {
      stdout: new ReadableStream({ start: (controller) => controller.close() }),
      stderr: new ReadableStream({ start: (controller) => controller.close() }),
      exited,
      terminate: () => this.end(143),
    }
  }

  which(): string | null {
    return null
  }
}

const opened: { registry: BunServiceRegistry; root: string }[] = []

function openRegistry(processes: ProcessPort): { registry: BunServiceRegistry } {
  const root = mkdtempSync(join(tmpdir(), 'atlas-services-settling-'))
  const registry = new BunServiceRegistry({
    root,
    clock: new SteppableClock(),
    logsDirectory: join(root, 'logs'),
    processes,
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

const settlingOf = async ({
  registry,
  wanted,
}: {
  registry: BunServiceRegistry
  wanted: boolean
}): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (registry.settling?.() === wanted) return
    await Bun.sleep(5)
  }
  throw new Error(`settling never became ${wanted}`)
}

describe('a service exit still settling', () => {
  it('is not settling for a running service, nor before its start has settled', async () => {
    const processes = new GatedPort()
    const { registry } = openRegistry(processes)
    expect(registry.settling?.()).toBe(false)
    const started = await registry.start({
      threadId: THREAD,
      command: 'serve',
      description: 'web dev server',
    })
    if (!started.ok) throw new Error(started.reason)
    expect(registry.settling?.()).toBe(false)
  })

  it('stays settling from a stop until the exit announcement has been queued', async () => {
    const processes = new GatedPort()
    const { registry } = openRegistry(processes)
    const started = await registry.start({
      threadId: THREAD,
      command: 'serve',
      description: 'web dev server',
    })
    if (!started.ok) throw new Error(started.reason)

    const stopped = registry.stop({ serviceId: started.snapshot.serviceId, by: EKilledBy.User })
    if (!stopped.ok) throw new Error(stopped.reason)

    await settlingOf({ registry, wanted: true })
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(0)
    await settlingOf({ registry, wanted: false })
    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
  })

  it('announces settled only once the exit announcement has landed', async () => {
    const processes = new GatedPort()
    const { registry } = openRegistry(processes)
    const announcements: number[] = []
    const unsubscribe = registry.onSettled?.(() => announcements.push(announcements.length))
    if (unsubscribe === undefined) throw new Error('onSettled is optional but must exist here')

    const started = await registry.start({
      threadId: THREAD,
      command: 'serve',
      description: 'web dev server',
    })
    if (!started.ok) throw new Error(started.reason)
    registry.stop({ serviceId: started.snapshot.serviceId, by: EKilledBy.User })

    await settlingOf({ registry, wanted: true })
    expect(announcements).toHaveLength(0)
    await settlingOf({ registry, wanted: false })
    expect(announcements).toHaveLength(1)
    expect(started.snapshot.serviceId.length).toBeGreaterThan(0)
    unsubscribe()
  })
})
