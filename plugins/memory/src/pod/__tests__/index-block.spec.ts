import { describe, expect, it } from 'bun:test'

import type { Assembled } from '@dltech/atlas-core'
import type { PluginPodContext, PodMemory } from '@dltech/atlas-plugin-sdk'

import { withMemoryIndex } from '../index-block'
import { markStale, type MemoryPodState } from '../state'
import { fakeMemory, rig } from './support'

const assembled: Assembled = { system: [{ text: 'You are Atlas.' }], messages: [] }

const state = (): MemoryPodState => ({ text: null, loading: null, failed: false, stale: false })

const ctxWith = (memory: PodMemory): Pick<PluginPodContext, 'control'> => ({
  control: {
    exposePort: async () => {
      throw new Error('no port')
    },
    memory,
  },
})

const memoryWith = (args: { project?: string | null } = {}) => {
  const memory = fakeMemory(args)
  const row = {
    scope: 'global' as const,
    name: 'dennis-prefers-bun',
    description: 'The workspace runs on Bun',
    type: 'user' as const,
    body: 'Bun.',
  }
  return { memory, row }
}

describe('withMemoryIndex', () => {
  it('appends the index as a system block on the first step', async () => {
    const { memory, row } = memoryWith()
    const port = memory.port
    await port.write(row)
    const next = await withMemoryIndex({
      assembled,
      ctx: ctxWith(port),
      state: state(),
    })
    const added = next.system[1]?.text ?? ''
    expect(next.system[0]?.text).toBe('You are Atlas.')
    expect(added).toContain('### Project dennisofficial/atlas')
    expect(added).toContain('- dennis-prefers-bun — The workspace runs on Bun')
  })

  it('loads the index once across steps', async () => {
    const { memory, row } = memoryWith()
    await memory.port.write(row)
    const held = state()
    const ctx = ctxWith(memory.port)
    await withMemoryIndex({ assembled, ctx, state: held })
    await withMemoryIndex({ assembled, ctx, state: held })
    expect(memory.calls).toEqual(['list'])
  })

  it('reloads after a memory changes', async () => {
    const { memory, row } = memoryWith()
    await memory.port.write(row)
    const held = state()
    const ctx = ctxWith(memory.port)
    await withMemoryIndex({ assembled, ctx, state: held })
    await memory.port.write({ ...row, name: 'second', description: 'Second entry' })
    markStale(held)
    const next = await withMemoryIndex({ assembled, ctx, state: held })
    expect(memory.calls).toEqual(['list', 'list'])
    expect(next.system[1]?.text).toContain('- second — Second entry')
  })

  it('says memory is unavailable, and retries on the next step', async () => {
    const held = state()
    const failing: PodMemory = {
      ...memoryWith().memory.port,
      list: async () => {
        throw new Error('the control plane rejected the call (500): boom')
      },
    }
    const first = await withMemoryIndex({ assembled, ctx: ctxWith(failing), state: held })
    expect(first.system[1]?.text).toBe(
      'Memory is unavailable this session: the control plane rejected the call (500): boom.',
    )
    const recovered = memoryWith()
    await recovered.memory.port.write(recovered.row)
    const second = await withMemoryIndex({
      assembled,
      ctx: ctxWith(recovered.memory.port),
      state: held,
    })
    expect(second.system[1]?.text).toContain('### Global')
  })

  it('leaves the prompt alone while the index is still loading', async () => {
    const { ctx } = rig()
    const held = state()
    const loading = withMemoryIndex({ assembled, ctx, state: held })
    const queued = await withMemoryIndex({ assembled, ctx, state: { ...held, text: null } })
    expect(queued.system).toHaveLength(1)
    await loading
  })
})
