import { describe, expect, it } from 'bun:test'

import {
  toEventId,
  toRunId,
  toThreadId,
  type Assembled,
  type Hash,
  type V2Event,
} from '@dltech/atlas-core'
import { type PluginPodContext, type PodMemory } from '@dltech/atlas-plugin-sdk'

import { memoryIndexResource, withMemoryIndex } from '../index-block'
import { memoryPod } from '..'
import { fakeMemory, rig } from './support'

const assembled: Assembled = { system: [{ text: 'You are Atlas.' }], messages: [] }

const UNAVAILABLE = 'Memory is unavailable this session: the memory index could not be loaded.'

const rowOf = (patch: { name?: string; description?: string } = {}) => ({
  scope: 'global' as const,
  name: patch.name ?? 'dennis-prefers-bun',
  description: patch.description ?? 'The workspace runs on Bun',
  type: 'user' as const,
  body: 'Bun.',
})

let sequence = 0

const loadedOf = (value: unknown): V2Event => {
  sequence += 1
  return {
    id: toEventId(`t:${sequence}`),
    seq: sequence,
    threadId: toThreadId('t1'),
    runId: toRunId('r1'),
    depth: 0,
    at: '2026-11-21T10:00:00.000Z',
    epoch: 1,
    prevHash: 'a'.repeat(64) as Hash,
    type: 'resource-loaded',
    resource: memoryIndexResource.name,
    fingerprint: 'unknown:unarmed::/work',
    value,
  }
}

const hostCtx = (args: { memory?: PodMemory; recorded: V2Event[] }): PluginPodContext => ({
  ...rig(args.memory).ctx,
  events: () => args.recorded,
})

const record = async (args: { memory: PodMemory; recorded: V2Event[] }): Promise<void> => {
  const value = await memoryIndexResource.load({
    ctx: hostCtx({ memory: args.memory, recorded: args.recorded }),
    directory: '/work',
  })
  args.recorded.push(loadedOf(value))
}

const render = (args: { ctx: Pick<PluginPodContext, 'events'> }): string =>
  withMemoryIndex({ assembled, ctx: args.ctx }).system[1]?.text ?? ''

describe('the memory index block', () => {
  it('is a resource the memory pod registers', () => {
    expect(memoryPod.resources?.map((resource) => resource.name)).toEqual(['memory-index'])
  })

  it('renders the recorded index as a system block', async () => {
    const memory = fakeMemory()
    await memory.port.write(rowOf())
    const recorded: V2Event[] = []
    await record({ memory: memory.port, recorded })
    const next = withMemoryIndex({
      assembled,
      ctx: { events: () => recorded },
    })
    expect(next.system[0]?.text).toBe('You are Atlas.')
    expect(next.system[1]?.text).toContain('### Project dennisofficial/atlas')
    expect(next.system[1]?.text).toContain('- dennis-prefers-bun — The workspace runs on Bun')
  })

  it('renders the same block however the control plane orders the entries', async () => {
    const memory = fakeMemory()
    await memory.port.write(rowOf())
    await memory.port.write(rowOf({ name: 'second', description: 'Second entry' }))
    const reversed: PodMemory = {
      ...memory.port,
      list: async () => {
        const listed = await memory.port.list()
        return { ...listed, memories: [...listed.memories].reverse() }
      },
    }
    const ordered: V2Event[] = []
    const backwards: V2Event[] = []
    await record({ memory: memory.port, recorded: ordered })
    await record({ memory: reversed, recorded: backwards })
    expect(render({ ctx: { events: () => backwards } })).toBe(
      render({ ctx: { events: () => ordered } }),
    )
  })

  it('renders the same block after the agent writes, edits and deletes', async () => {
    const memory = fakeMemory()
    await memory.port.write(rowOf())
    const recorded: V2Event[] = []
    await record({ memory: memory.port, recorded })
    const first = render({ ctx: { events: () => recorded } })

    await memory.port.write(rowOf({ name: 'second', description: 'Second entry' }))
    await memory.port.edit({
      scope: 'global',
      name: 'dennis-prefers-bun',
      old: 'Bun.',
      new: 'Bun, always.',
      revision: 1,
    })
    await memory.port.delete({ scope: 'global', name: 'second' })

    expect(render({ ctx: { events: () => recorded } })).toBe(first)
    expect(memory.calls).toEqual(['list'])
  })

  it('renders the recorded text on a fresh host without listing again', async () => {
    const memory = fakeMemory()
    await memory.port.write(rowOf())
    const recorded: V2Event[] = []
    await record({ memory: memory.port, recorded })
    const listed = render({ ctx: { events: () => recorded } })

    const fresh: PodMemory = {
      ...fakeMemory().port,
      list: async () => {
        throw new Error('a fresh host must render from the record')
      },
    }
    const freshCtx = hostCtx({ memory: fresh, recorded })
    expect(render({ ctx: freshCtx })).toBe(listed)
  })

  it('says the index is unavailable until a load is recorded', async () => {
    const recorded: V2Event[] = []
    expect(render({ ctx: { events: () => recorded } })).toBe(UNAVAILABLE)

    const failing: PodMemory = {
      ...fakeMemory().port,
      list: async () => {
        throw new Error('the control plane rejected the call (500): boom')
      },
    }
    const failed = record({ memory: failing, recorded })
    await expect(failed).rejects.toThrow('the control plane rejected the call (500): boom')
    expect(recorded).toEqual([])
    expect(render({ ctx: { events: () => recorded } })).toBe(UNAVAILABLE)

    const memory = fakeMemory()
    await memory.port.write(rowOf())
    await record({ memory: memory.port, recorded })
    expect(render({ ctx: { events: () => recorded } })).toContain('### Global')
  })
})
