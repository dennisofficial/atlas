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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BunServiceRegistry } from '../service-registry'
import { ERestartVerdict, restartVerdict, type Scheduler } from '../service-supervisor'

const THREAD = toThreadId('thread-supervised')

class FakeClock implements ClockPort {
  millis = Date.parse('2026-10-29T12:00:00.000Z')
  now(): string {
    return new Date(this.millis).toISOString()
  }
}

class FakeProcesses implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  private readonly ends: ((code: number) => void)[] = []

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
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

type Timer = { ms: number; run: () => void; cancelled: boolean }

const harness = () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-supervision-'))
  const processes = new FakeProcesses()
  const clock = new FakeClock()
  const timers: Timer[] = []
  const scheduler: Scheduler = ({ ms, run }) => {
    const timer = { ms, run, cancelled: false }
    timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }
  const registry = new BunServiceRegistry({
    root,
    clock,
    logsDirectory: join(root, 'logs'),
    processes,
    scheduler,
  })
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return { registry, processes, clock, timers, root }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const flush = () => Bun.sleep(10)
const live = (timers: Timer[]) => timers.filter((timer) => !timer.cancelled)

const startNamed = (registry: BunServiceRegistry) =>
  registry.start({
    threadId: THREAD,
    name: 'web',
    port: 24001,
    command: 'serve',
    description: 'web',
    env: { PORT: '24001' },
  })

describe('restartVerdict', () => {
  it('backs off 1,2,4,8,16 seconds then gives up on the sixth crash in the window', () => {
    const delays = [1, 2, 3, 4, 5].map((count) => {
      const verdict = restartVerdict({
        crashTimes: Array.from({ length: count }, (_, index) => 1_000 * index),
        nowMs: 1_000 * count,
      })
      return verdict.verdict === ERestartVerdict.Restart ? verdict.delayMs : -1
    })
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000])

    const sixth = restartVerdict({ crashTimes: [0, 1, 2, 3, 4, 5], nowMs: 6 })
    expect(sixth.verdict).toBe(ERestartVerdict.GiveUp)
  })

  it('forgets crashes older than 120 seconds', () => {
    const verdict = restartVerdict({ crashTimes: [0, 1, 2, 3, 4, 200_000], nowMs: 200_000 })
    expect(verdict).toEqual({ verdict: ERestartVerdict.Restart, delayMs: 1_000, crashes: 1 })
  })
})

describe('a named service under supervision', () => {
  it('restarts after a crash with the same name, port and env', async () => {
    const { registry, processes, timers } = harness()
    await startNamed(registry)

    processes.crash(0)
    await flush()
    expect(live(timers).map((timer) => timer.ms)).toEqual([1_000])

    live(timers)[0]?.run()
    await flush()

    expect(processes.spawned).toHaveLength(2)
    expect(processes.spawned[1]?.env?.PORT).toBe('24001')
    const running = registry.list().filter((one) => one.status === EServiceStatus.Running)
    expect(running.map((one) => [one.name, one.port])).toEqual([['web', 24001]])
  })

  it('does not restart a service the model stopped', async () => {
    const { registry, timers } = harness()
    const started = await startNamed(registry)
    if (!started.ok) throw new Error(started.reason)

    registry.stop({ serviceId: started.snapshot.serviceId, by: EKilledBy.Model })
    await flush()

    expect(live(timers)).toHaveLength(0)
  })

  it('does not restart once supervision is suspended for a park', async () => {
    const { registry, processes, timers } = harness()
    await startNamed(registry)

    registry.suspendSupervision()
    processes.crash(0)
    await flush()

    expect(live(timers)).toHaveLength(0)
    expect(processes.spawned).toHaveLength(1)
  })

  it('cancels a pending restart when supervision is suspended', async () => {
    const { registry, processes, timers } = harness()
    await startNamed(registry)
    processes.crash(0)
    await flush()
    expect(registry.restartPending({ name: 'web' })).toBe(true)

    registry.suspendSupervision()

    expect(live(timers)).toHaveLength(0)
    expect(registry.restartPending({ name: 'web' })).toBe(false)
  })

  it('stops restarting after more than five crashes in two minutes and says so in the log', async () => {
    const { registry, processes, timers } = harness()
    await startNamed(registry)

    for (let crash = 0; crash < 6; crash += 1) {
      processes.crash(crash)
      await flush()
      const next = live(timers).at(-1)
      if (crash < 5) {
        next?.run()
        await flush()
      }
    }

    expect(processes.spawned).toHaveLength(6)
    expect(registry.crashLooping({ name: 'web' })).toBe(true)
    const [first] = registry.list()
    expect(readFileSync(first?.logPath ?? '', 'utf8')).toBe('')
    const last = registry.list().at(-1)
    expect(readFileSync(last?.logPath ?? '', 'utf8')).toContain('crash-looping')
  })

  it('does not supervise a one-off service without a name', async () => {
    const { registry, processes, timers } = harness()
    await registry.start({ threadId: THREAD, command: 'x', description: 'one-off' })

    processes.crash(0)
    await flush()

    expect(live(timers)).toHaveLength(0)
  })

  it('restart replaces the process and keeps the name and port', async () => {
    const { registry, processes } = harness()
    const started = await startNamed(registry)
    if (!started.ok) throw new Error(started.reason)

    const restarted = await registry.restart({ serviceId: started.snapshot.serviceId })

    expect(restarted.ok && restarted.snapshot.name).toBe('web')
    expect(processes.spawned).toHaveLength(2)
  })
})
