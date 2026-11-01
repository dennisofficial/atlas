import { describe, expect, it } from 'bun:test'

import type { SandboxDeadlineObservation } from '@dltech/atlas-wire'

import { startDeadlineRenewal, type DeadlineControl } from '../deadline-renewal-loop'
import { startServeIdleStop } from '../idle-stop'
import type { ServeLogLine } from '../serve-log'

const MIN = 60_000
const HOUR = 60 * MIN
const BOOT = 1_000_000

const fakeProvider = (args: { clock: () => number; timeoutMs: number }) => {
  let expiresAt = BOOT + args.timeoutMs
  let sessionId = 'session-1'
  const calls: number[] = []
  let failNext = 0
  let gate: Promise<void> | undefined
  const control: DeadlineControl = {
    renew: async ({ until }): Promise<SandboxDeadlineObservation> => {
      calls.push(until)
      if (gate !== undefined) await gate
      if (failNext > 0) {
        failNext -= 1
        throw new Error('control plane unavailable')
      }
      if (sessionId !== 'session-1') throw new Error('refusing to renew: stale session')
      if (args.clock() >= expiresAt) throw new Error('session stopped')
      const extendedByMs = Math.max(0, until - expiresAt)
      expiresAt += extendedByMs
      return { sessionId, expiresAt, startedAt: BOOT, extendedByMs }
    },
  }
  return {
    control,
    calls,
    expiresAt: () => expiresAt,
    failNext: (count: number) => {
      failNext = count
    },
    replaceSession: () => {
      sessionId = 'session-2'
    },
    hold: () => {
      let release = (): void => undefined
      gate = new Promise((resolve) => {
        release = resolve
      })
      return () => {
        gate = undefined
        release()
      }
    },
  }
}

const runtime = (over: { timeoutMs?: number; hardLimitMs?: number } = {}) => {
  let now = BOOT
  const work = { turnRunning: false, children: 0, shells: 0, services: 0, clients: 0 }
  const provider = fakeProvider({ clock: () => now, timeoutMs: over.timeoutMs ?? 4 * HOUR })
  const parks: number[] = []
  const logs: ServeLogLine[] = []
  const idle = startServeIdleStop({
    turnRunning: () => work.turnRunning,
    childrenSettling: () => false,
    runningChildren: () => work.children,
    runningShells: () => work.shells,
    runningServices: () => work.services,
    clientsAttached: () => work.clients,
    onDue: () => parks.push(now),
    tickMs: 24 * HOUR,
    now: () => now,
  })
  const loop = startDeadlineRenewal({
    control: provider.control,
    working: () => work.turnRunning || work.children > 0 || work.shells > 0,
    quietSince: idle.quietSince,
    graceMs: 30 * MIN,
    log: (line) => logs.push(line),
    now: () => now,
    tickMs: 24 * HOUR,
    hardLimitMs: over.hardLimitMs,
  })
  const step = async (ms: number): Promise<void> => {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + 30_000)
      if (now >= provider.expiresAt()) throw new Error(`provider expired at ${now - BOOT}ms`)
      idle.check()
      await loop.tick()
    }
  }
  const stop = () => {
    idle.halt()
    loop.halt()
  }
  return { work, provider, parks, logs, idle, loop, step, stop, now: () => now }
}

describe('deadline renewal with the idle stop', () => {
  it('an active child keeps a top-level-idle session alive past four hours with no client', async () => {
    const pod = runtime()
    pod.work.children = 1
    await pod.step(10 * HOUR)
    expect(pod.parks).toHaveLength(0)
    expect(pod.provider.expiresAt()).toBeGreaterThan(pod.now() + 30 * MIN)
    pod.stop()
  })

  it('work completion starts the grace; quiet expiry parks once and before the deadline', async () => {
    const pod = runtime()
    pod.work.children = 1
    await pod.step(5 * HOUR)
    pod.work.children = 0
    const ended = pod.now()
    await pod.step(29 * MIN)
    expect(pod.parks).toHaveLength(0)
    await pod.step(2 * MIN)
    expect(pod.parks).toHaveLength(1)
    expect(pod.parks[0]).toBeLessThanOrEqual(ended + 31 * MIN)
    expect(pod.provider.expiresAt()).toBeGreaterThan(pod.parks[0] ?? 0)
    await pod.step(10 * MIN)
    expect(pod.parks).toHaveLength(1)
    pod.stop()
  })

  it('new work during the grace cancels the park and a fresh quiet window follows it', async () => {
    const pod = runtime()
    pod.work.turnRunning = true
    await pod.step(4 * HOUR)
    pod.work.turnRunning = false
    await pod.step(20 * MIN)
    pod.work.shells = 1
    await pod.step(HOUR)
    pod.work.shells = 0
    await pod.step(29 * MIN)
    expect(pod.parks).toHaveLength(0)
    await pod.step(2 * MIN)
    expect(pod.parks).toHaveLength(1)
    pod.stop()
  })

  it('a quiet pod with a running service and an attached client is never extended', async () => {
    const pod = runtime()
    pod.work.services = 1
    pod.work.clients = 1
    await pod.step(2 * HOUR)
    expect(pod.provider.expiresAt()).toBe(BOOT + 4 * HOUR)
    expect(pod.logs.some((line) => line.event === 'serve.deadline-renewed')).toBe(false)
    expect(pod.parks).toHaveLength(1)
    pod.stop()
  })

  it('a short boot deadline still gives quiet work its full grace', async () => {
    const pod = runtime({ timeoutMs: 10 * MIN })
    await pod.step(31 * MIN)
    expect(pod.parks).toHaveLength(1)
    expect(pod.provider.expiresAt()).toBeLessThanOrEqual(BOOT + 36 * MIN)
    pod.stop()
  })

  it('a failed renewal is logged and retried while budget remains', async () => {
    const pod = runtime({ timeoutMs: 40 * MIN })
    pod.work.children = 1
    pod.provider.failNext(3)
    await pod.step(2 * HOUR)
    const failures = pod.logs.filter((line) => line.event === 'serve.deadline-renew-failed')
    expect(failures).toHaveLength(3)
    expect(failures[0]).toMatchObject({ attempt: 1, working: true })
    expect(pod.logs.some((line) => line.event === 'serve.deadline-renewed')).toBe(true)
    pod.stop()
  })

  it('a stale provider session is refused and surfaces as a failure, never a success', async () => {
    const pod = runtime({ timeoutMs: 40 * MIN })
    pod.work.children = 1
    pod.provider.replaceSession()
    await pod.step(10 * MIN)
    expect(pod.loop.state().failures).toBeGreaterThan(0)
    expect(pod.logs.some((line) => line.event === 'serve.deadline-renewed')).toBe(false)
    pod.stop()
  })

  it('concurrent ticks share one in-flight renewal', async () => {
    const pod = runtime({ timeoutMs: 40 * MIN })
    pod.work.children = 1
    const release = pod.provider.hold()
    const before = pod.provider.calls.length
    const first = pod.loop.tick()
    const second = pod.loop.tick()
    expect(pod.provider.calls.length - before).toBeLessThanOrEqual(1)
    release()
    await Promise.all([first, second])
    pod.stop()
  })

  it('a halt during an in-flight renewal discards its result and stops further renewals', async () => {
    const pod = runtime({ timeoutMs: 40 * MIN })
    pod.work.children = 1
    await pod.loop.tick()
    const release = pod.provider.hold()
    const pending = pod.loop.tick()
    pod.loop.halt()
    release()
    await pending
    const calls = pod.provider.calls.length
    await pod.loop.tick()
    expect(pod.provider.calls).toHaveLength(calls)
    expect(pod.loop.state().halted).toBe(true)
    pod.stop()
  })

  it('reports risk once when the provider hard limit cuts into the grace', async () => {
    const pod = runtime({ hardLimitMs: 6 * HOUR })
    pod.work.children = 1
    await pod.step(5 * HOUR + 50 * MIN)
    const risks = pod.logs.filter((line) => line.event === 'serve.deadline-at-risk')
    expect(risks).toHaveLength(1)
    expect(pod.provider.expiresAt()).toBe(BOOT + 6 * HOUR)
    pod.stop()
  })
})
