import { describe, expect, it } from 'bun:test'

import { ControlPlane, RecordCorruptError } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { FakeTool, ScriptedModel } from '@dltech/atlas-agent/testing'
import type { ToolOutcome } from '@dltech/atlas-core'

import { DRAIN_DETACH_CAP_MS, DRAIN_IN_FLIGHT_CAP_MS } from '../drain-cap'
import { FakeClock, flushUntil, makeRig, seedSession, SESSION } from './holder-rig'

class StallingPlane extends ControlPlane {
  stalled = false
  refusing = false

  override append(
    params: Parameters<ControlPlane['append']>[0],
  ): ReturnType<ControlPlane['append']> {
    if (this.stalled) return new Promise(() => {})
    if (this.refusing) return Promise.reject(new RecordCorruptError('injected append refusal'))
    return super.append(params)
  }
}

class GatedTool extends FakeTool {
  started = false
  private release: (() => void) | undefined

  constructor() {
    super('slow', 'done')
  }

  releaseNow(): void {
    this.release?.()
  }

  override async invoke(): Promise<ToolOutcome> {
    this.started = true
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    return { ok: true, output: 'done', modelText: 'done' }
  }
}

describe('SessionHolder drain while a record append never settles', () => {
  it('finishes within its cap and hands the session back for another host', async () => {
    const clock = new FakeClock()
    const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
    const plane = new StallingPlane({ store })
    const model = new ScriptedModel([
      { calls: [{ callId: 'call-1', name: 'slow', input: {} }] },
      { text: 'done' },
    ])
    const tool = new GatedTool()
    const a = await makeRig({ plane, store, clock, model: () => model, hostTools: [tool] })
    await seedSession(a)
    await a.holder.start()
    await a.post('go')
    await a.wake()
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    plane.stalled = true
    tool.releaseNow()
    await a.flush()

    let drained = false
    void a.holder.drain().then(() => {
      drained = true
    })
    await a.flush()
    clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await a.flush()
    clock.advance(DRAIN_DETACH_CAP_MS)

    expect(await flushUntil({ check: () => drained })).toBe(true)
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease).toMatchObject({ holderHostId: null, wantsHolder: true })
  }, 15_000)

  it('finishes when the detach append at the cap fails', async () => {
    const clock = new FakeClock()
    const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
    const plane = new StallingPlane({ store })
    const model = new ScriptedModel([
      { calls: [{ callId: 'call-1', name: 'slow', input: {} }] },
      { text: 'done' },
    ])
    const tool = new GatedTool()
    const a = await makeRig({ plane, store, clock, model: () => model, hostTools: [tool] })
    await seedSession(a)
    await a.holder.start()
    await a.post('go')
    await a.wake()
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    let drained = false
    void a.holder.drain().then(() => {
      drained = true
    })
    await a.flush()
    plane.refusing = true
    clock.advance(DRAIN_IN_FLIGHT_CAP_MS)
    await a.flush()
    clock.advance(DRAIN_DETACH_CAP_MS)

    expect(await flushUntil({ check: () => drained })).toBe(true)
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 15_000)

  it('waits the drain cap it was given, not the default one', async () => {
    const clock = new FakeClock()
    const store = new InMemoryControlStore({ clock: () => new Date(clock.now()).toISOString() })
    const plane = new StallingPlane({ store })
    const model = new ScriptedModel([
      { calls: [{ callId: 'call-1', name: 'slow', input: {} }] },
      { text: 'done' },
    ])
    const tool = new GatedTool()
    const a = await makeRig({
      plane,
      store,
      clock,
      model: () => model,
      hostTools: [tool],
      drainCapMs: 1_000,
    })
    await seedSession(a)
    await a.holder.start()
    await a.post('go')
    await a.wake()
    expect(await flushUntil({ check: () => tool.started })).toBe(true)

    plane.stalled = true
    tool.releaseNow()
    await a.flush()

    let drained = false
    void a.holder.drain().then(() => {
      drained = true
    })
    await a.flush()
    clock.advance(1_000)
    await a.flush()
    clock.advance(DRAIN_DETACH_CAP_MS)

    expect(await flushUntil({ check: () => drained })).toBe(true)
    const { lease } = await a.plane.currentLease({ sessionId: SESSION })
    expect(lease.holderHostId).toBeNull()
  }, 15_000)
})
