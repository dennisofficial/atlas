import {
  EMPTY_MCP_CONTROL,
  type McpSignInBegin,
  type PluginPodContext,
} from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'
import { describe, expect, it } from 'bun:test'

import { EDefinitionOrigin } from '@dltech/atlas-core'

import { EMcpSignInResult, EMcpViewStatus, type McpCloudRow } from '../../core'
import { MCP_CONFIG, mcpConfigResource } from '../resources'
import { McpSignInBook } from '../sign-in-book'
import { McpSignInTool } from '../sign-in'
import { fakeDaemon, invocation, recordingRig, snapshotEventOf } from './support'

const SERVER_URL = 'https://mcp.test/mcp'

const AUTHORIZE_URL = 'https://provider.test/authorize?client_id=c&code_challenge=xyz'

const EXPIRES_AT = '2026-11-10T12:10:00.000Z'

type Draft = { type: string } & Record<string, unknown>

const rowsOf = (transport: Record<string, unknown>): readonly McpCloudRow[] => [
  { source: 'user', spec: { name: 'posthog', transport } },
]

const start = async (
  args: { rows?: readonly McpCloudRow[]; begin?: () => Promise<McpSignInBegin> } = {},
) => {
  const rows = args.rows ?? rowsOf({ kind: 'http', url: SERVER_URL })
  const appended: Draft[] = []
  const recording = recordingRig(fakeDaemon())
  const config = mcpConfigResource({ config: { read: async () => ({ rows, rejections: [] }) } })
  const snapshot = await config.load({ ctx: recording.ctx, directory: '/repo' })
  const signIns = new McpSignInBook()
  const ctx: PluginPodContext = {
    ...recording.ctx,
    control: {
      ...podControlStub,
      mcp: {
        ...EMPTY_MCP_CONTROL,
        begin: async () =>
          args.begin === undefined
            ? { ok: true, url: AUTHORIZE_URL, expiresAt: EXPIRES_AT }
            : await args.begin(),
      },
    },
    events: () => [snapshotEventOf({ resource: MCP_CONFIG, value: snapshot })],
    append: async (drafts) => {
      appended.push(...(drafts as unknown as Draft[]))
    },
  }
  return {
    appended,
    signIns,
    tool: new McpSignInTool({ ctx, resource: config, signIns }),
  }
}

const startedCards = (appended: readonly Draft[]): Draft[] =>
  appended.filter((draft) => draft.type === 'mcp-sign-in-started')

describe('operator_mcp_sign_in drawing a card', () => {
  it('answers in plain text and draws nothing when the session has no such server', async () => {
    const { appended, tool } = await start()

    expect(await tool.invoke(invocation({ name: 'ghost' }))).toEqual({
      ok: false,
      reason: 'no MCP server is named ghost in this session; the mcp view lists the ones it has',
    })
    expect(startedCards(appended)).toEqual([])
  })

  it('answers in plain text and draws nothing when the provider refuses to start a flow', async () => {
    const { appended, tool } = await start({
      begin: async () => ({ ok: false, reason: 'no grant' }),
    })

    expect(await tool.invoke(invocation({ name: 'posthog' }))).toEqual({
      ok: false,
      reason: 'no grant',
    })
    expect(startedCards(appended)).toEqual([])
  })

  it('refuses a stdio server, which carries its own credentials', async () => {
    const { tool } = await start({ rows: rowsOf({ kind: 'stdio', command: 'paper' }) })

    expect(await tool.invoke(invocation({ name: 'posthog' }))).toEqual({
      ok: false,
      reason:
        'the posthog MCP server starts a process that carries its own credentials, so it has no sign-in to start',
    })
  })

  it('records the card and remembers the flow for the server', async () => {
    const begun: string[] = []
    const { appended, signIns, tool } = await start({
      begin: async () => {
        begun.push('posthog')
        return { ok: true, url: AUTHORIZE_URL, expiresAt: EXPIRES_AT }
      },
    })

    const outcome = await tool.invoke(invocation({ name: 'posthog' }))

    expect(outcome?.ok).toBe(true)
    expect(begun).toEqual(['posthog'])
    expect(startedCards(appended)).toEqual([
      {
        type: 'mcp-sign-in-started',
        server: 'posthog',
        url: AUTHORIZE_URL,
        expiresAt: EXPIRES_AT,
        sessionId: 's1',
      },
    ])
    expect(
      signIns.resolutionsOf({
        sessionId: 's1',
        rows: [
          {
            name: 'posthog',
            transport: 'http',
            status: EMcpViewStatus.Connected,
            toolCount: 1,
            layer: EDefinitionOrigin.User,
          },
        ],
        now: Date.parse('2026-11-20T12:00:00.000Z'),
      }),
    ).toEqual([
      {
        type: 'mcp-sign-in-resolved',
        server: 'posthog',
        result: EMcpSignInResult.Connected,
        sessionId: 's1',
      },
    ])
  })
})
