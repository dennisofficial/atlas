import { toEventId, toRunId, toThreadId, type V2Event } from '@dltech/atlas-core'
import type { PluginPodContext, PodMcpControl } from '@dltech/atlas-plugin-sdk'

import type { McpCloudRow } from '../../core'
import { McpSignInBook } from '../sign-in-book'
import { MCP_CONFIG, MCP_TOOLS, mcpConfigResource, mcpToolsResource } from '../resources'
import type { McpConfigSnapshot, McpToolsSnapshot } from '../snapshot'
import { rig } from './rig'
import type { fakeDaemon } from './support'

export const THREAD = toThreadId('t1')

export const eventOf = (draft: object, seq: number): V2Event =>
  ({
    ...draft,
    id: toEventId(`t:${seq}`),
    seq,
    threadId: THREAD,
    runId: toRunId('r'),
    depth: 0,
    at: '2026-11-20T12:00:00.000Z',
    epoch: 1,
    prevHash: 'a'.repeat(64),
  }) as V2Event

export const snapshotEventOf = (args: {
  resource: string
  value: unknown
  seq?: number
}): V2Event =>
  eventOf(
    {
      type: 'resource-loaded',
      resource: args.resource,
      fingerprint: 'f',
      value: args.value,
    },
    args.seq ?? 1,
  )

export type Recording = {
  ctx: PluginPodContext
  events: V2Event[]
}

export const recordingRig = (
  daemon: ReturnType<typeof fakeDaemon>,
  args: { records?: readonly V2Event[]; mcp?: PodMcpControl } = {},
): Recording => {
  const events: V2Event[] = [...(args.records ?? [])]
  const ctx: PluginPodContext = {
    ...rig(daemon, args.mcp === undefined ? {} : { mcp: args.mcp }),
    events: () => events,
    append: async (drafts) => {
      for (const draft of drafts) events.push(eventOf(draft, events.length + 1))
    },
  }
  return { ctx, events }
}

const cloudOf = (rows: readonly McpCloudRow[], rejections: readonly never[] = []) => ({
  read: async () => ({ rows, rejections }),
})

export const loadConfig = async (args: {
  daemon: ReturnType<typeof fakeDaemon>
  rows: readonly McpCloudRow[]
  records?: readonly V2Event[]
  directory?: string
}): Promise<{ snapshot: McpConfigSnapshot; recording: Recording }> => {
  const recording = recordingRig(args.daemon, {
    ...(args.records === undefined ? {} : { records: args.records }),
  })
  const resource = mcpConfigResource({ config: cloudOf(args.rows) })
  const snapshot = await resource.load({
    ctx: recording.ctx,
    directory: args.directory ?? '/repo',
  })
  return { snapshot, recording }
}

export const loadTools = async (args: {
  daemon: ReturnType<typeof fakeDaemon>
  rows: readonly McpCloudRow[]
  records?: readonly V2Event[]
  mcp?: PodMcpControl
  connectTimeoutMs?: number
  directory?: string
}): Promise<{ snapshot: McpToolsSnapshot; recording: Recording }> => {
  const recording = recordingRig(args.daemon, {
    ...(args.records === undefined ? {} : { records: args.records }),
    ...(args.mcp === undefined ? {} : { mcp: args.mcp }),
  })
  const resource = mcpToolsResource({
    config: cloudOf(args.rows),
    connectTimeoutMs: args.connectTimeoutMs ?? 200,
    signIns: new McpSignInBook(),
  })
  const snapshot = await resource.load({
    ctx: recording.ctx,
    directory: args.directory ?? '/repo',
  })
  return { snapshot, recording }
}

export { MCP_CONFIG, MCP_TOOLS }
