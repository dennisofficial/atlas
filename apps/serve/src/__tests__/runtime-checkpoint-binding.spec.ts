import { describe, expect, it } from 'vitest'

import { ERuntimePhase, runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { bindRuntimeCheckpoint } from '../runtime-checkpoint-binding'

const checkpoint = (args: { phase: ERuntimePhase; revision: number }): RuntimeCheckpoint =>
  runtimeCheckpointSchema.parse({
    threadId: 'thread',
    runtimeId: 'runtime',
    sandboxSessionId: 'session',
    revision: args.revision,
    phase: args.phase,
    reportedAt: '2026-10-01T00:00:00.000Z',
    transcript: { head: args.revision, count: args.revision, digest: 'a'.repeat(64) },
  })

const gate = () => {
  let open = (): void => undefined
  const done = new Promise<void>((resolve) => {
    open = resolve
  })
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
      publish: (value) => {
        published.push(value)
      },
      capture: {
        capture: async ({ phase }) => {
          revision += 1
          phases.push(phase)
          if (revision === 2) {
            entered.open()
            await held.done
          }
          return checkpoint({ phase, revision })
        },
        flush: async () => undefined,
        consumeReceipt: async () => undefined,
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
    expect(phases).toEqual([ERuntimePhase.Serving, ERuntimePhase.Serving, ERuntimePhase.Parked])
    expect(published.map((value) => value.revision)).toEqual([1, 2, 3])
    expect(binding.current()?.phase).toBe(ERuntimePhase.Parked)
    binding.running()
    expect(phases).toHaveLength(3)
  })

  it('never writes Serving between Parking and Parked when the park marker publishes mid-park', async () => {
    const phases: ERuntimePhase[] = []
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
        flush: async () => undefined,
        consumeReceipt: async () => undefined,
      },
    })
    await binding.boot()
    await binding.parkBegin({ attempts: 1 })
    binding.running()
    await binding.finalizePark()
    expect(phases).toEqual([ERuntimePhase.Serving, ERuntimePhase.Parking, ERuntimePhase.Parked])
    expect(binding.current()?.phase).toBe(ERuntimePhase.Parked)
  })

  it('lets a Serving capture already in flight land before Parking, then holds the rest', async () => {
    const entered = gate()
    const held = gate()
    const phases: ERuntimePhase[] = []
    let revision = 0
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: () => undefined,
      capture: {
        capture: async ({ phase }) => {
          revision += 1
          phases.push(phase)
          if (revision === 2) {
            entered.open()
            await held.done
          }
          return checkpoint({ phase, revision })
        },
        flush: async () => undefined,
        consumeReceipt: async () => undefined,
      },
    })
    await binding.boot()
    binding.running()
    await entered.done
    const parkBegan = binding.parkBegin({ attempts: 1 })
    binding.running()
    held.open()
    await parkBegan
    binding.running()
    await binding.finalizePark()
    expect(phases).toEqual([
      ERuntimePhase.Serving,
      ERuntimePhase.Serving,
      ERuntimePhase.Parking,
      ERuntimePhase.Parked,
    ])
  })

  it('resumes Serving captures after a refused park reopens', async () => {
    const phases: ERuntimePhase[] = []
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
        flush: async () => undefined,
        consumeReceipt: async () => undefined,
      },
    })
    await binding.boot()
    await binding.parkBegin({ attempts: 1 })
    binding.running()
    await binding.parkReopened()
    binding.running()
    await Promise.resolve()
    await Promise.resolve()
    expect(phases).toEqual([
      ERuntimePhase.Serving,
      ERuntimePhase.Parking,
      ERuntimePhase.Serving,
      ERuntimePhase.Serving,
    ])
  })

  it('keeps checkpoint absent when the runtime cannot produce a valid identity', async () => {
    const published: RuntimeCheckpoint[] = []
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: (value) => {
        published.push(value)
      },
      capture: {
        capture: async () => null,
        flush: async () => undefined,
        consumeReceipt: async () => undefined,
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
        capture: async ({ phase, resume }) => {
          revision += 1
          phases.push(phase)
          if (phase === ERuntimePhase.Updating) {
            if (resume === undefined)
              throw new Error('the updating seal must carry its resume payload')
            const base = {
              threadId: 'thread',
              runtimeId: 'runtime',
              sandboxSessionId: 'session',
              revision,
              phase: ERuntimePhase.Updating as const,
              reportedAt: '2026-10-01T00:00:00.000Z',
              transcript: { head: revision, count: revision, digest: 'a'.repeat(64) },
            }
            const checkpoint = {
              ...base,
              receipt: {
                version: 1 as const,
                threadId: base.threadId,
                sandboxSessionId: base.sandboxSessionId,
                resumeParent: resume.parent,
                ...(resume.children === undefined ? {} : { resumeChildren: [...resume.children] }),
                checkpoint: base,
              },
            }
            return runtimeCheckpointSchema.parse(checkpoint)
          }
          return checkpoint({ phase, revision })
        },
        flush: async () => {
          flushed += 1
        },
        consumeReceipt: async () => undefined,
      },
    })
    await binding.boot()
    await binding.finalizeRotation({ resume: { parent: true } })
    binding.running()
    expect(phases).toEqual([ERuntimePhase.Serving, ERuntimePhase.Updating])
    const sealed = binding.current()
    expect(sealed?.phase).toBe(ERuntimePhase.Updating)
    if (sealed?.phase === ERuntimePhase.Updating) {
      expect(sealed.receipt.checkpoint.revision).toBe(sealed.revision)
      expect(sealed.receipt.resumeParent).toBe(true)
    }
    expect(flushed).toBe(1)
  })

  it('refuses to claim a rotation seal it could not capture', async () => {
    const binding = bindRuntimeCheckpoint({
      log: () => undefined,
      publish: () => undefined,
      capture: {
        capture: async () => null,
        flush: async () => undefined,
        consumeReceipt: async () => undefined,
      },
    })
    await expect(binding.finalizeRotation({ resume: { parent: true } })).rejects.toThrow(
      'no final rotation checkpoint',
    )
  })
})
