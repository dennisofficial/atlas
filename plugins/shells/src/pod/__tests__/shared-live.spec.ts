import { describe, expect, it } from 'bun:test'

import { PodRuntimeScope, type PluginPodContext } from '@dltech/atlas-plugin-sdk'
import type { CallResult } from '@dltech/atlas-protocol'

import { shellsPod } from '..'
import { LIVE_READ_LIMIT } from '../live-watch'
import { stateFor } from '../state'
import { rig, seedShell } from './support'

const settle = async (): Promise<void> => {
  for (let turns = 0; turns < 20; turns += 1) await Bun.sleep(1)
}

const childOf = (ctx: PluginPodContext) => {
  const abort = new AbortController()
  const child = {
    ...ctx,
    onDaemonEvent: (listener: Parameters<PluginPodContext['onDaemonEvent']>[0]) => {
      const off = ctx.onDaemonEvent(listener)
      abort.signal.addEventListener('abort', off, { once: true })
      return off
    },
  }
  return { ctx: child, stop: () => abort.abort() }
}

describe('runtime-owned shell publishing', () => {
  it('publishes one chunk once across two plugin contexts', async () => {
    const harness = rig()
    const child = childOf(harness.ctx)
    shellsPod.hooks?.(harness.ctx)
    shellsPod.hooks?.(child.ctx)
    const shellId = await seedShell({ harness })

    harness.print(shellId, 'hello\n')
    harness.output(shellId)
    await settle()

    expect(harness.liveFrames).toEqual([
      { type: 'shell-output', shellId, offset: 0, text: 'hello\n' },
    ])
    expect(stateFor(harness.ctx).live).toBe(stateFor(child.ctx).live)
    expect(stateFor(harness.ctx).cursors).not.toBe(stateFor(child.ctx).cursors)
  })

  it('does not replay old bytes when a late child reconciles its shells', async () => {
    const harness = rig()
    shellsPod.hooks?.(harness.ctx)
    const shellId = await seedShell({ harness })
    harness.print(shellId, 'before\n')
    harness.output(shellId)
    await settle()

    const child = childOf(harness.ctx)
    shellsPod.hooks?.(child.ctx)
    await settle()
    harness.print(shellId, 'after\n')
    harness.output(shellId)
    await settle()

    expect(harness.liveFrames).toEqual([
      { type: 'shell-output', shellId, offset: 0, text: 'before\n' },
      { type: 'shell-output', shellId, offset: 7, text: 'after\n' },
    ])
  })

  it('keeps publishing after the child that first used the pump exits', async () => {
    const harness = rig()
    const child = childOf(harness.ctx)
    shellsPod.hooks?.(child.ctx)
    const shellId = await seedShell({ harness })
    harness.print(shellId, 'before\n')
    harness.output(shellId)
    await settle()
    child.stop()
    expect(harness.listeners.size).toBe(1)

    harness.print(shellId, 'after\n')
    harness.output(shellId)
    await settle()

    expect(harness.liveFrames.at(-1)).toEqual({
      type: 'shell-output',
      shellId,
      offset: 7,
      text: 'after\n',
    })
  })

  it('invalidates an old read without blocking output from a replacement daemon', async () => {
    const harness = rig()
    const call = harness.ctx.call
    const pending = Promise.withResolvers<CallResult>()
    let held = false
    harness.ctx.call = async (op, options) => {
      const answer = await call(op, options)
      if (op.op !== 'shells.read' || held) return answer
      held = true
      return await pending.promise
    }
    const runtime = new PodRuntimeScope(harness.ctx)
    harness.ctx.runtime = runtime
    shellsPod.hooks?.(harness.ctx)
    const shellId = await seedShell({ harness })
    harness.print(shellId, 'stale\n')
    const stale = await call({ op: 'shells.read', shellId, offset: 0, limit: LIVE_READ_LIMIT })
    harness.output(shellId)
    await settle()
    expect(held).toBe(true)
    runtime.reset()
    const shell = harness.shells.get(shellId)
    if (shell === undefined) throw new Error('missing shell')
    shell.buffer = Buffer.alloc(0)
    harness.print(shellId, 'fresh\n')
    harness.output(shellId)
    await settle()
    expect(harness.liveFrames).toEqual([
      { type: 'shell-output', shellId, offset: 0, text: 'fresh\n' },
    ])

    pending.resolve(stale)
    await settle()
    expect(harness.liveFrames).toHaveLength(1)
    expect(harness.listeners.size).toBe(2)
  })

  it('drops an incomplete UTF-8 decoder on replacement and keeps character offsets', async () => {
    const harness = rig()
    shellsPod.hooks?.(harness.ctx)
    const shellId = await seedShell({ harness })
    const shell = harness.shells.get(shellId)
    if (shell === undefined) throw new Error('missing shell')
    shell.buffer = Buffer.from([0xe2])
    harness.output(shellId)
    await settle()
    expect(harness.liveFrames).toHaveLength(0)
    harness.runtime.reset()
    shell.buffer = Buffer.alloc(0)
    harness.print(shellId, `${'a'.repeat(LIVE_READ_LIMIT - 1)}€z`)
    harness.output(shellId)
    await settle()

    const frames = harness.liveFrames.flatMap((frame) =>
      frame.type === 'shell-output' ? [frame] : [],
    )
    expect(frames.map((frame) => frame.text).join('')).toBe(`${'a'.repeat(LIVE_READ_LIMIT - 1)}€z`)
    expect(frames.map((frame) => frame.offset)).toEqual([0, LIVE_READ_LIMIT - 1])
  })

  it('unsubscribes and drops pending reads when the runtime is released', async () => {
    const harness = rig()
    shellsPod.hooks?.(harness.ctx)
    const shellId = await seedShell({ harness })
    harness.print(shellId, 'pending\n')
    harness.output(shellId)
    harness.runtime.dispose()
    await settle()

    expect(harness.liveFrames).toHaveLength(0)
    expect(harness.listeners.size).toBe(1)
    harness.output(shellId)
    stateFor(harness.ctx).live.note(shellId)
    await settle()
    expect(harness.liveFrames).toHaveLength(0)
  })

  it('does not reuse the publisher of another held runtime with the same session id', async () => {
    const previous = rig()
    shellsPod.hooks?.(previous.ctx)
    const oldShellId = await seedShell({ harness: previous })
    previous.print(oldShellId, 'old\n')
    previous.output(oldShellId)
    await settle()
    previous.runtime.dispose()

    const current = rig()
    shellsPod.hooks?.(current.ctx)
    expect(current.ctx.sessionId).toBe(previous.ctx.sessionId)
    expect(stateFor(current.ctx).live).not.toBe(stateFor(previous.ctx).live)
    const shellId = await seedShell({ harness: current })
    current.print(shellId, 'new\n')
    current.output(shellId)
    await settle()
    expect(current.liveFrames).toEqual([
      { type: 'shell-output', shellId, offset: 0, text: 'new\n' },
    ])
  })
})
