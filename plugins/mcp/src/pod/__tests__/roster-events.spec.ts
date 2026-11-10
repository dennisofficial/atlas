import type { McpCloudRow } from '../../core'
import { EMcpViewStatus } from '../../core'
import { describe, expect, it } from 'bun:test'

import { McpStore } from '../store'
import { fakeDaemon, rig } from './support'

const transport = { kind: 'stdio' as const, command: 'bun', args: ['run', 'server'] }

const recordingRig = (daemon: ReturnType<typeof fakeDaemon>) => {
  const appended: unknown[] = []
  const ctx = {
    ...rig(daemon),
    append: async (drafts: readonly unknown[]) => void appended.push(...drafts),
  }
  return { ctx, appended }
}

const storeWith = (args: {
  ctx: ReturnType<typeof recordingRig>['ctx']
  rows: () => readonly McpCloudRow[]
}) =>
  new McpStore({
    ctx: args.ctx,
    config: { read: async () => ({ rows: args.rows(), rejections: [] }) },
    connectTimeoutMs: 200,
    reconcileBudgetMs: 200,
  })

describe('the mcp view event body', () => {
  it('appends one changed row when a server connects', async () => {
    const daemon = fakeDaemon({ docs: { tools: [{ name: 'search' }] } })
    const { ctx, appended } = recordingRig(daemon)
    const store = storeWith({
      ctx,
      rows: () => [{ source: 'user', spec: { name: 'docs', transport } }],
    })
    await store.boot()
    expect(appended).toEqual([
      {
        type: 'mcp-server-changed',
        row: {
          name: 'docs',
          transport: 'stdio',
          status: EMcpViewStatus.Connected,
          toolCount: 1,
          layer: 'user',
        },
      },
    ])
  })

  it('appends a failed row with its reason', async () => {
    const daemon = fakeDaemon({
      docs: { exit: { exitCode: 1, signal: null }, stderr: ['boom'] },
    })
    const { ctx, appended } = recordingRig(daemon)
    const store = storeWith({
      ctx,
      rows: () => [{ source: 'project', spec: { name: 'docs', transport } }],
    })
    await store.boot()
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      type: 'mcp-server-changed',
      row: { name: 'docs', status: EMcpViewStatus.Failed, toolCount: 0, layer: 'project' },
    })
  })

  it('appends nothing when no row changed on reconcile', async () => {
    const daemon = fakeDaemon({ docs: { tools: [{ name: 'search' }] } })
    const { ctx, appended } = recordingRig(daemon)
    const store = storeWith({
      ctx,
      rows: () => [{ source: 'user', spec: { name: 'docs', transport } }],
    })
    await store.boot()
    await store.reconcile()
    expect(appended).toHaveLength(1)
  })

  it('appends a removal when a server leaves the config', async () => {
    const daemon = fakeDaemon({ docs: { tools: [{ name: 'search' }] } })
    const { ctx, appended } = recordingRig(daemon)
    let rows: readonly McpCloudRow[] = [{ source: 'user', spec: { name: 'docs', transport } }]
    const store = storeWith({ ctx, rows: () => rows })
    await store.boot()
    rows = []
    await store.reconcile()
    expect(appended.at(-1)).toEqual({ type: 'mcp-server-removed', name: 'docs' })
  })
})
