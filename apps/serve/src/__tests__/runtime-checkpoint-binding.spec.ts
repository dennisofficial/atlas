import { describe, expect, it } from 'bun:test'

import { ERuntimePhase, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { bindRuntimeCheckpoint } from '../runtime-checkpoint-binding'

const checkpoint = (args: { phase: ERuntimePhase; revision: number }): RuntimeCheckpoint => ({
  threadId: 'thread', runtimeId: 'runtime', sandboxSessionId: 'session',
  revision: args.revision, phase: args.phase, reportedAt: '2026-10-01T00:00:00.000Z',
  transcript: { head: args.revision, count: args.revision, digest: 'a'.repeat(64) },
})

const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => { open = resolve })
  return { done, open }
}

describe('serve checkpoint lifecycle binding', () => {
  it('orders in-flight running capture before final park and suppresses later running requests', async () => {
    const entered = gate()
    const held = gate()
    const phases: ERuntimePhase[] = []
    const published: RuntimeCheckpoint[] = []
    let revision = 0
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: (value) => { published.push(value) },
      capture: {
        capture: async ({ phase }) => {
          revision += 1
          phases.push(phase)
          if (revision === 2) { entered.open(); await held.done }
          return checkpoint({ phase, revision })
        },
        flush: async () => undefined,
      },
    })
    await binding.boot()
    binding.running()
    await entered.done
    binding.running()
    const parking = binding.finalizePark()
    binding.running()
    held.open()
    await parking
    expect(phases).toEqual([ERuntimePhase.Running, ERuntimePhase.Running, ERuntimePhase.Parked])
    expect(published.map((value) => value.revision)).toEqual([1, 2, 3])
    expect(binding.current()?.phase).toBe(ERuntimePhase.Parked)
    binding.running()
    expect(phases).toHaveLength(3)
  })

  it('keeps checkpoint absent when the runtime cannot produce a valid identity', async () => {
    const published: RuntimeCheckpoint[] = []
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: (value) => { published.push(value) },
      capture: {
        capture: async () => null,
        flush: async () => undefined,
      },
    })
    await binding.boot()
    expect(binding.current()).toBeNull()
    expect(published).toHaveLength(0)
    await expect(binding.finalizePark()).rejects.toThrow('no final park checkpoint')
  })

  it('seals a rotating checkpoint, then suppresses later running captures', async () => {
    const phases: ERuntimePhase[] = []
    let flushed = 0
    let revision = 0
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: () => undefined,
      capture: {
        capture: async ({ phase }) => {
          revision += 1
          phases.push(phase)
          return checkpoint({ phase, revision })
        },
        flush: async () => { flushed += 1 },
      },
    })
    await binding.boot()
    await binding.finalizeRotation()
    binding.running()
    expect(phases).toEqual([ERuntimePhase.Running, ERuntimePhase.Rotating])
    expect(binding.current()?.phase).toBe(ERuntimePhase.Rotating)
    expect(flushed).toBe(1)
  })

  it('refuses to claim a rotation seal it could not capture', async () => {
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: () => undefined,
      capture: { capture: async () => null, flush: async () => undefined },
    })
    await expect(binding.finalizeRotation()).rejects.toThrow('no final rotation checkpoint')
  })
})
