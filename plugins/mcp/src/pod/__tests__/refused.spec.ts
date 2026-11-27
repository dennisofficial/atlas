import { EMcpToken, EMPTY_MCP_CONTROL, type PodMcpControl } from '@dltech/atlas-plugin-sdk'
import { describe, expect, it } from 'bun:test'

import { EMcpSignInResult, EMcpViewStatus, type McpCloudRow } from '../../core'
import { mcpToolsResource } from '../resources'
import { rowsOf } from '../roster'
import { McpSignInBook } from '../sign-in-book'
import { EMcpServerStatus } from '../snapshot'
import { recordingRig } from './recording'
import { fakeDaemon } from './support'

const SERVER_URL = 'https://mcp.test/mcp'

const REASON = 'mcp.test answered: access_denied'

const REFUSED_AT = '2027-01-01T00:00:00.000Z'

const rowsOfConfig = (): readonly McpCloudRow[] => [
  { source: 'user', spec: { name: 'posthog', transport: { kind: 'http', url: SERVER_URL } } },
]

const refusing = (reason: string): PodMcpControl => ({
  ...EMPTY_MCP_CONTROL,
  token: async () => ({ kind: EMcpToken.Refused, reason }),
})

type Draft = { type: string } & Record<string, unknown>

const draftsOf = (drafts: readonly unknown[]): Draft[] => drafts as unknown as Draft[]

describe('a server whose last sign-in was refused', () => {
  it('reads as failed with the provider reason and resolves its card failed', async () => {
    const signIns = new McpSignInBook()
    signIns.note({ server: 'posthog', expiresAt: REFUSED_AT })
    const resource = mcpToolsResource({
      config: { read: async () => ({ rows: rowsOfConfig(), rejections: [] }) },
      connectTimeoutMs: 200,
      signIns,
    })
    const recording = recordingRig(fakeDaemon(), { mcp: refusing(REASON) })

    const value = await resource.load({ ctx: recording.ctx, directory: '/repo' })
    const announced = draftsOf(resource.announce?.(value, recording.ctx) ?? [])

    expect(value.servers[0]).toMatchObject({
      status: EMcpServerStatus.Failed,
      reason: REASON,
    })
    expect(rowsOf(value)[0]).toMatchObject({
      status: EMcpViewStatus.Failed,
      reason: REASON,
    })
    expect(announced.find((draft) => draft.type === 'mcp-sign-in-resolved')).toEqual({
      type: 'mcp-sign-in-resolved',
      server: 'posthog',
      result: EMcpSignInResult.Failed,
      sessionId: 's1',
      reason: REASON,
    })
    expect(announced.find((draft) => draft.type === 'mcp-server-changed')).toMatchObject({
      row: { name: 'posthog', status: EMcpViewStatus.Failed, reason: REASON },
    })
  })
})
