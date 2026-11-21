import { EContextSlot, EDefinitionOrigin } from '@dltech/atlas-core'

import { EMcpViewStatus } from '../../core'
import { describe, expect, it } from 'bun:test'

import { mcpToolsResource, MCP_TOOLS } from '../resources'
import { McpSignInBook } from '../sign-in-book'
import { EMcpServerStatus, type McpToolsSnapshot } from '../snapshot'
import { fakeDaemon, recordingRig, snapshotEventOf } from './support'

const snapshotOf = (args: { instructions?: string; configHash?: string }): McpToolsSnapshot => ({
  configHash: args.configHash ?? 'h',
  directory: '/repo',
  servers: [
    {
      name: 'echo',
      origin: EDefinitionOrigin.User,
      transportKind: 'stdio',
      configHash: args.configHash ?? 'c1',
      status: EMcpServerStatus.Connected,
      tools: [{ name: 'search' }],
      ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
    },
  ],
})

const resourceOf = () =>
  mcpToolsResource({
    config: { read: async () => ({ rows: [], rejections: [] }) },
    connectTimeoutMs: 200,
    signIns: new McpSignInBook(),
  })

describe('instructions in the turn that connects', () => {
  it('emits the context-loaded draft in the very first turn a server connects', () => {
    const { ctx } = recordingRig(fakeDaemon())
    const drafts = resourceOf().announce?.(snapshotOf({ instructions: 'Echo round trips.' }), ctx)

    expect(drafts ?? []).toContainEqual({
      type: 'context-loaded',
      slot: EContextSlot.McpInstructions,
      key: 'echo',
      content: 'Echo round trips.',
    })
  })
})

describe('a server that failed', () => {
  it('keeps its reason until the config changes, and republishes only then', () => {
    const failed: McpToolsSnapshot = {
      configHash: 'h2',
      directory: '/repo',
      servers: [
        {
          name: 'echo',
          origin: EDefinitionOrigin.User,
          transportKind: 'stdio',
          configHash: 'c2',
          status: EMcpServerStatus.Failed,
          reason: 'the server exited with code 1',
          tools: [],
        },
      ],
    }
    const { ctx } = recordingRig(fakeDaemon(), {
      records: [snapshotEventOf({ resource: MCP_TOOLS, value: snapshotOf({}) })],
    })

    expect(resourceOf().announce?.(failed, ctx)).toContainEqual({
      type: 'mcp-server-changed',
      row: {
        name: 'echo',
        transport: 'stdio',
        status: EMcpViewStatus.Failed,
        toolCount: 0,
        reason: 'the server exited with code 1',
        layer: EDefinitionOrigin.User,
      },
    })
  })
})
