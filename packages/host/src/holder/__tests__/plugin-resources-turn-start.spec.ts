import { HookChain, type RegisteredHook } from '@dltech/atlas-agent'
import { EStage, type Assembled, type BeforeStep } from '@dltech/atlas-core'
import { readResource, type PodResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { watchIdOf } from '../plugin-resource-probes'
import { pluginResourcesHook, refreshInFlightOf } from '../plugin-resources'
import { DIRECTORY, agentsRootOf, rig, THREAD } from './plugin-resources-rig'

const BUDGET_MS = 50
const LOAD_MS = 300
const RELOAD_MS = 400
const INDEX_TEXT = 'Memory index (stub)'
const INSTRUCTIONS = 'INSTRUCTION TEXT'

type MemoryIndex = { readonly text: string }

type Step = { readonly source: string; readonly read: () => string | undefined }

const BASE: Assembled = { system: [{ text: 'BASE PROMPT', source: 'system-prompt' }], messages: [] }

const sleep = (ms: number): Promise<undefined> =>
  new Promise((resolve) => setTimeout(() => resolve(undefined), ms))

const memoryIndexOf = (): PodResource<MemoryIndex> => ({
  name: 'memory-index',
  schema: z.object({ text: z.string() }),
  load: async () => ({ text: INDEX_TEXT }),
})

const instructionsOf = (delayMs: number): PodResource<string> => ({
  name: 'instructions',
  schema: z.string(),
  load: async () => {
    await sleep(delayMs)
    return INSTRUCTIONS
  },
})

const watchedOf = (args: {
  name: string
  root: string
  loads: string[]
  value: () => string
  delayMs?: (() => number) | undefined
}): PodResource<string> => ({
  name: args.name,
  schema: z.string(),
  watch: () => ({ roots: [args.root] }),
  load: async () => {
    args.loads.push(args.name)
    await sleep(args.delayMs?.() ?? 0)
    return args.value()
  },
})

const stepOf = (step: Step): RegisteredHook<BeforeStep> => ({
  name: step.source,
  order: { stage: EStage.Observe, nudge: 0 },
  awaited: true,
  run: async ({ assembled }) => {
    const text = step.read()
    if (text === undefined) return assembled
    return { ...assembled, system: [...assembled.system, { text, source: step.source }] }
  },
})

const textAt = (args: { assembled: Assembled; source: string }): string | undefined =>
  args.assembled.system.find((block) => block.source === args.source)?.text

const chainOf = (args: {
  ctx: Parameters<typeof pluginResourcesHook>[0]['ctx']
  resources: readonly PodResource<unknown>[]
  steps: readonly Step[]
  mishaps: string[]
}): HookChain =>
  new HookChain({
    beforeTurn: [pluginResourcesHook({ ctx: args.ctx, resources: args.resources })],
    beforeStep: args.steps.map(stepOf),
    budgetMs: BUDGET_MS,
    onMishap: (mishap) => args.mishaps.push(`${mishap.label} ${mishap.kind}: ${mishap.detail}`),
  })

describe('the turn starts from recorded plugin resources', () => {
  it('awaits a load that has no recorded snapshot, so the first call has the blocks', async () => {
    const index = memoryIndexOf()
    const instructions = instructionsOf(LOAD_MS)
    const turn = rig({ resources: [index, instructions] })
    const mishaps: string[] = []
    const chain = chainOf({
      ctx: turn.ctx,
      resources: [index, instructions],
      mishaps,
      steps: [
        {
          source: 'memory-index',
          read: () => readResource({ ctx: turn.ctx, resource: index })?.text,
        },
        {
          source: 'instructions',
          read: () => readResource({ ctx: turn.ctx, resource: instructions }),
        },
      ],
    })

    const started = Date.now()
    await chain.beforeTurn({ threadId: THREAD, projectDirectory: DIRECTORY })
    const hookMs = Date.now() - started
    const first = await chain.beforeStep({ assembled: BASE, trace: [] })

    expect(mishaps).toEqual([])
    expect(hookMs).toBeGreaterThanOrEqual(LOAD_MS)
    expect(textAt({ assembled: first, source: 'instructions' })).toBe(INSTRUCTIONS)
    expect(textAt({ assembled: first, source: 'memory-index' })).toBe(INDEX_TEXT)
  }, 10_000)

  it('returns at once when every resource is recorded and appends the reload after the call', async () => {
    const loads: string[] = []
    let delay = 0
    let value = 'one'
    const root = agentsRootOf(DIRECTORY)
    const skills = watchedOf({
      name: 'skills',
      root,
      loads,
      value: () => value,
      delayMs: () => delay,
    })
    const turn = rig({ resources: [skills] })
    await turn.run()
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')

    delay = RELOAD_MS
    value = 'two'
    turn.daemon.seqs.set(watchIdOf({ roots: [root] }), 1)

    const mishaps: string[] = []
    const chain = chainOf({
      ctx: turn.ctx,
      resources: [skills],
      mishaps,
      steps: [{ source: 'skills', read: () => readResource({ ctx: turn.ctx, resource: skills }) }],
    })

    const started = Date.now()
    await chain.beforeTurn({ threadId: THREAD, projectDirectory: DIRECTORY })
    const hookMs = Date.now() - started
    const first = await chain.beforeStep({ assembled: BASE, trace: [] })

    expect(mishaps).toEqual([])
    expect(hookMs).toBeLessThan(BUDGET_MS)
    expect(textAt({ assembled: first, source: 'skills' })).toBe('one')

    await refreshInFlightOf(turn.ctx)
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('two')
    expect(loads).toEqual(['skills', 'skills'])
  }, 10_000)

  it('appends each resource as its own load settles', async () => {
    const resources = [memoryIndexOf(), instructionsOf(LOAD_MS)]
    const turn = rig({ resources })
    const hook = pluginResourcesHook({ ctx: turn.ctx, resources })
    const running = hook.run({ threadId: THREAD, projectDirectory: DIRECTORY })

    await sleep(LOAD_MS / 2)
    const midFlight = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.resource] : [],
    )
    expect(midFlight).toEqual(['memory-index'])

    await running
    const settled = turn.events.flatMap((event) =>
      event.type === 'resource-loaded' ? [event.resource] : [],
    )
    expect(settled.sort()).toEqual(['instructions', 'memory-index'])
  }, 10_000)

  it('runs one refresh when two turns overlap', async () => {
    const loads: string[] = []
    const skills = watchedOf({
      name: 'skills',
      root: agentsRootOf(DIRECTORY),
      loads,
      value: () => 'one',
      delayMs: () => LOAD_MS,
    })
    const turn = rig({ resources: [skills] })
    const hook = pluginResourcesHook({ ctx: turn.ctx, resources: [skills] })

    await Promise.all([
      hook.run({ threadId: THREAD, projectDirectory: DIRECTORY }),
      hook.run({ threadId: THREAD, projectDirectory: DIRECTORY }),
    ])

    expect(loads).toEqual(['skills'])
    expect(turn.calls.filter((call) => call.op === 'watch.status')).toHaveLength(1)
  }, 10_000)

  it('arms the watches of a turn concurrently', async () => {
    const loads: string[] = []
    const concurrent = { active: 0, most: 0 }
    const skills = watchedOf({
      name: 'skills',
      root: `${DIRECTORY}/.agents`,
      loads,
      value: () => 'one',
    })
    const crew = watchedOf({
      name: 'crew',
      root: `${DIRECTORY}/.claude`,
      loads,
      value: () => 'crew',
    })
    const turn = rig({
      resources: [skills, crew],
      beforeCall: async (op) => {
        if (op.op !== 'watch.start') return
        concurrent.active += 1
        concurrent.most = Math.max(concurrent.most, concurrent.active)
        await sleep(20)
        concurrent.active -= 1
      },
    })
    await turn.run()

    expect(concurrent.most).toBe(2)
    expect(turn.calls.filter((call) => call.op === 'watch.start')).toHaveLength(2)
    expect(readResource({ ctx: turn.ctx, resource: skills })).toBe('one')
    expect(readResource({ ctx: turn.ctx, resource: crew })).toBe('crew')
  }, 10_000)
})
