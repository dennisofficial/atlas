import { EContextSlot, orderHooks, toThreadId, type EventDraft } from '@dltech/atlas-core'
import type { PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { EMcpViewStatus, type McpCloudRow } from '../../core'
import { mcpPod } from '..'
import { McpStore } from '../store'
import { fakeDaemon, rig } from './support'

const docsTransport = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const searchTool = {
  name: 'search',
  description: 'Find documentation',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
}

const rowsOf = (): readonly McpCloudRow[] => [
  { source: 'user', spec: { name: 'docs', transport: docsTransport } },
]

type Appended = Parameters<NonNullable<PluginPodContext['append']>>[0]

describe('instructions in the turn that connects', () => {
  it('emits the context-loaded draft in the very first turn a server connects', async () => {
    const daemon = fakeDaemon({
      echo: { tools: [searchTool], instructions: 'Echo round trips.' },
    })
    const pod = mcpPod({
      config: {
        read: async () => ({
          rows: [{ source: 'user', spec: { name: 'echo', transport: docsTransport } }],
          rejections: [],
        }),
      },
    })
    const hooks = pod.hooks?.(rig(daemon)) ?? {}
    const drafts: EventDraft[] = []
    for (const hook of orderHooks(hooks.beforeTurn ?? [])) {
      const outcome = await hook.run({ threadId: toThreadId('t1'), projectDirectory: '/repo' })
      drafts.push(...(outcome.drafts ?? []))
    }
    expect(drafts).toEqual([
      {
        type: 'context-loaded',
        slot: EContextSlot.McpInstructions,
        key: 'echo',
        content: 'Echo round trips.',
      },
    ])
  })
})

describe('a server that dies mid-turn', () => {
  it('flips its row to failed with the exit reason and publishes it, with no reconcile', async () => {
    const daemon = fakeDaemon({ docs: { tools: [searchTool] } })
    let nextAppend: (drafts: Appended) => void = () => undefined
    const ctx = {
      ...rig(daemon),
      append: async (drafts: Appended): Promise<void> => {
        nextAppend(drafts)
      },
    }
    const store = new McpStore({
      ctx,
      config: { read: async () => ({ rows: rowsOf(), rejections: [] }) },
      connectTimeoutMs: 200,
      reconcileBudgetMs: 200,
    })
    await store.boot()
    expect(store.rows()[0]?.status).toBe(EMcpViewStatus.Connected)

    const flipped = new Promise<Appended>((resolve) => {
      nextAppend = resolve
    })
    daemon.kill('docs')
    const drafts = await flipped

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      type: 'mcp-server-changed',
      row: { name: 'docs', status: EMcpViewStatus.Failed },
    })
    expect(store.rows()[0]?.status).toBe(EMcpViewStatus.Failed)
    expect(store.rows()[0]?.reason).toContain('SIGTERM')
  })
})
