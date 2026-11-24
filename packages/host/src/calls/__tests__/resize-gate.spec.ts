import { describe, expect, it } from 'bun:test'

import {
  EPodResizeProbe,
  POD_RESIZE_HARD_CAP_MS,
  POD_RESIZE_SOFT_PROBE_MS,
  type PodResizeOpen,
} from '@dltech/atlas-core'

import { ResizeGate } from '../resize-gate'

const T0 = 1_700_000_000_000

type Scheduled = { at: number; run(): void }

const clockOf = () => {
  let now = T0
  const scheduled: Scheduled[] = []
  const timers = {
    now: () => now,
    setTimeout: (handler: () => void, ms: number) => {
      const entry = { at: now + ms, run: handler }
      scheduled.push(entry)
      return entry
    },
    clearTimeout: (timer: unknown) => {
      const at = scheduled.indexOf(timer as Scheduled)
      if (at >= 0) scheduled.splice(at, 1)
    },
    random: () => 0,
  }
  const flush = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  }
  const advance = async (ms: number): Promise<void> => {
    now += ms
    for (const entry of [...scheduled]) {
      if (entry.at > now) continue
      scheduled.splice(scheduled.indexOf(entry), 1)
      entry.run()
    }
    await flush()
  }
  return { timers, advance, flush }
}

const REASON = 'the pod is being resized to 16 vCPU / 64 GB'

const holdAt = (startedAt: number) => ({ open: openAt(startedAt), reason: REASON })

const openAt = (startedAt: number): PodResizeOpen => ({
  generation: 3,
  vcpus: 16,
  memoryGb: 64,
  startedAt,
})

const settledWithin = async (promise: Promise<unknown>): Promise<boolean> => {
  let settled = false
  void promise.then(() => {
    settled = true
  })
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  return settled
}

describe('ResizeGate', () => {
  it('probes once when it arms on a resize older than half a minute', async () => {
    const clock = clockOf()
    const probes: number[] = []
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => {
        probes.push(clock.timers.now())
        return EPodResizeProbe.Updating
      },
    })
    gate.hold(holdAt(T0 - 60_000))
    await clock.flush()
    expect(probes).toEqual([T0])
    expect(await settledWithin(gate.wait({}))).toBe(false)
  })

  it('does not probe before the arm deadline of a fresh resize', async () => {
    const clock = clockOf()
    let probes = 0
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => {
        probes += 1
        return EPodResizeProbe.Updating
      },
    })
    gate.hold(holdAt(T0 - 1_000))
    await clock.flush()
    expect(probes).toBe(0)
    await clock.advance(30_000)
    expect(probes).toBe(1)
  })

  it('releases the waiters when the probe finds the pod at its target', async () => {
    const clock = clockOf()
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => EPodResizeProbe.AtTarget,
    })
    gate.hold(holdAt(T0 - 60_000))
    const waiting = gate.wait({})
    await clock.flush()
    expect(await settledWithin(waiting)).toBe(true)
    expect(gate.open).toBeUndefined()
  })

  it('releases on the matching generation only', () => {
    const clock = clockOf()
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => EPodResizeProbe.Updating,
    })
    gate.hold(holdAt(T0 - 60_000))
    expect(gate.settled({ generation: 2 })).toBe(false)
    expect(gate.open).toBeDefined()
    expect(gate.settled({ generation: 3 })).toBe(true)
    expect(gate.open).toBeUndefined()
  })

  it('releases at the hard cap after a probe that never finds the target', async () => {
    const clock = clockOf()
    let probes = 0
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => {
        probes += 1
        return EPodResizeProbe.Updating
      },
    })
    gate.hold(holdAt(T0 - 60_000))
    const waiting = gate.wait({})
    await clock.flush()
    await clock.advance(POD_RESIZE_SOFT_PROBE_MS)
    expect(probes).toBe(2)
    expect(await settledWithin(waiting)).toBe(false)
    await clock.advance(POD_RESIZE_HARD_CAP_MS)
    expect(await settledWithin(waiting)).toBe(true)
  })

  it('stops waiting when the waiter is aborted', async () => {
    const clock = clockOf()
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => EPodResizeProbe.Updating,
    })
    gate.hold(holdAt(T0 - 60_000))
    const controller = new AbortController()
    const waiting = gate.wait({ signal: controller.signal })
    await clock.flush()
    controller.abort()
    expect(await settledWithin(waiting)).toBe(true)
    expect(gate.open).toBeDefined()
  })

  it('releases every waiter on release', async () => {
    const clock = clockOf()
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => EPodResizeProbe.Updating,
    })
    gate.hold(holdAt(T0 - 60_000))
    const both = Promise.all([gate.wait({}), gate.wait({})])
    await clock.flush()
    gate.release()
    expect(await settledWithin(both)).toBe(true)
  })
})

describe('ResizeGate after a generation completed', () => {
  it('does not arm or probe a generation the probe already found at its target', async () => {
    const clock = clockOf()
    let probes = 0
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => {
        probes += 1
        return EPodResizeProbe.AtTarget
      },
    })
    for (let lap = 0; lap < 3; lap += 1) {
      gate.hold(holdAt(T0 - 60_000))
      await clock.flush()
    }
    expect(probes).toBe(1)
    expect(gate.open).toBeUndefined()
    expect(await settledWithin(gate.wait({}))).toBe(true)
  })

  it('does not arm a generation that was settled by its notice', async () => {
    const clock = clockOf()
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => EPodResizeProbe.Updating,
    })
    gate.hold(holdAt(T0))
    gate.settled({ generation: 3 })
    gate.hold(holdAt(T0))
    expect(gate.open).toBeUndefined()
  })

  it('still arms a newer generation', async () => {
    const clock = clockOf()
    const gate = new ResizeGate({
      timers: clock.timers,
      now: clock.timers.now,
      probe: async () => EPodResizeProbe.AtTarget,
    })
    gate.hold(holdAt(T0 - 60_000))
    await clock.flush()
    gate.hold({ open: { ...openAt(T0), generation: 4 }, reason: REASON })
    expect(gate.open?.generation).toBe(4)
  })
})
