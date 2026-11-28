import { EContextSlot, type EventDraft } from '@dltech/atlas-core'
import type { PluginPodContext, PodResource } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { watchIdOf } from '../plugin-resource-probes'
import { DIRECTORY, agentsRootOf, rig } from './plugin-resources-rig'

const WATCH_ID = watchIdOf({ roots: [agentsRootOf(DIRECTORY)] })

const KEY = 'paper'

const INSTRUCTIONS = 'instructions v1'

type Gate = { readonly promise: Promise<string>; open(value: string): void }

const gateOf = (): Gate => {
  let open = (_value: string): void => undefined
  const promise = new Promise<string>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const offeredOf = (ctx: PluginPodContext): string => {
  let offered = ''
  for (const event of ctx.events()) {
    if (event.type === 'context-loaded' && event.key === KEY) offered = event.content
  }
  return offered
}

const instructionsDraftOf = (args: { ctx: PluginPodContext; content: string }): EventDraft[] => {
  if (offeredOf(args.ctx) === args.content) return []
  return [
    {
      type: 'context-loaded',
      slot: EContextSlot.McpInstructions,
      key: KEY,
      content: args.content,
    },
  ]
}

const backgroundToolsOf = (args: {
  loads: string[]
  loading: () => Promise<string>
  concurrent: { active: number; most: number }
}): PodResource<string> => ({
  name: 'mcp-tools',
  schema: z.string(),
  watch: () => ({ roots: [agentsRootOf(DIRECTORY)] }),
  background: true,
  announce: (value, ctx) => instructionsDraftOf({ ctx, content: value }),
  load: async () => {
    args.loads.push('mcp-tools')
    args.concurrent.active += 1
    args.concurrent.most = Math.max(args.concurrent.most, args.concurrent.active)
    try {
      return await args.loading()
    } finally {
      args.concurrent.active -= 1
    }
  },
})

const ofType = (args: {
  events: readonly { type: string }[]
  type: string
}): readonly { type: string; [key: string]: unknown }[] =>
  args.events.filter((event) => event.type === args.type)

describe('a background resource loads once at a time', () => {
  it('queues a change that arrives mid-load and announces it once', async () => {
    const loads: string[] = []
    const concurrent = { active: 0, most: 0 }
    const gate = gateOf()
    const turn = rig({
      resources: [
        backgroundToolsOf({ loads, loading: async () => await gate.promise, concurrent }),
      ],
    })
    await turn.run()
    expect(loads).toEqual(['mcp-tools'])

    turn.daemon.seqs.set(WATCH_ID, 1)
    turn.changed(WATCH_ID)
    await tick()
    expect(loads).toEqual(['mcp-tools'])

    gate.open(INSTRUCTIONS)
    await tick()
    await turn.settled()

    const loaded = ofType({ events: turn.events, type: 'resource-loaded' })
    const announced = ofType({ events: turn.events, type: 'context-loaded' })
    expect(concurrent.most).toBe(1)
    expect(loads).toEqual(['mcp-tools', 'mcp-tools'])
    expect(loaded.map((event) => event['fingerprint'])).toEqual([`instance-1:0::${DIRECTORY}`])
    expect(announced).toHaveLength(1)
  }, 10_000)

  it('starts no second background load while one is still in flight', async () => {
    const loads: string[] = []
    const concurrent = { active: 0, most: 0 }
    const gate = gateOf()
    const turn = rig({
      resources: [
        backgroundToolsOf({ loads, loading: async () => await gate.promise, concurrent }),
      ],
    })
    await turn.run()

    turn.reconnect(true)
    await tick()
    expect(loads).toEqual(['mcp-tools'])

    gate.open(INSTRUCTIONS)
    await tick()
    await turn.settled()

    expect(concurrent.most).toBe(1)
    expect(ofType({ events: turn.events, type: 'resource-loaded' })).toHaveLength(1)
    expect(ofType({ events: turn.events, type: 'context-loaded' })).toHaveLength(1)
  }, 10_000)
})
