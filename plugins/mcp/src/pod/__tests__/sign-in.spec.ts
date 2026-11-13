import { describe, expect, it } from 'bun:test'
import type { McpSignInBegin, PluginPodContext } from '@dltech/atlas-plugin-sdk'
import { podControlStub } from '@dltech/atlas-plugin-sdk/testing'

import { LINK_EXPIRED_REASON, type McpCloudRow } from '../../core'
import { McpSignInTool } from '../sign-in'
import { McpStore } from '../store'
import { fakeDaemon, invocation, rig } from './support'

const SERVER_URL = 'https://mcp.test/mcp'

const AUTHORIZE_URL = 'https://provider.test/authorize?client_id=c&code_challenge=xyz'

const EXPIRES_AT = '2026-11-10T12:10:00.000Z'

type Captured = { method: string; headers: Record<string, string>; body: Record<string, unknown> }

type Draft = { type: string } & Record<string, unknown>

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const handshake = (request: Captured): Response => {
  if (request.method === 'DELETE') return new Response(null, { status: 200 })
  if (request.body['method'] === 'initialize')
    return json({
      jsonrpc: '2.0',
      id: request.body['id'],
      result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's' } },
    })
  return new Response(null, { status: 202 })
}

const stubFetch = (answer: (request: Captured) => Response): (() => void) => {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Captured = {
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body:
        typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {},
    }
    return answer(request)
  }) as typeof globalThis.fetch
  return () => {
    globalThis.fetch = original
  }
}

const unauthorized = (request: Captured): Response =>
  request.method === 'DELETE'
    ? new Response(null, { status: 200 })
    : new Response('no', { status: 401 })

const needsAuthRows: readonly McpCloudRow[] = [
  { source: 'user', spec: { name: 'posthog', transport: { kind: 'http', url: SERVER_URL } } },
]

const start = async (args: { begin?: () => Promise<McpSignInBegin> } = {}) => {
  const appended: Draft[] = []
  const config = { read: async () => ({ rows: needsAuthRows, rejections: [] }) }
  const held = { token: undefined as string | undefined }
  const ctx: PluginPodContext = {
    ...rig(fakeDaemon()),
    control: {
      ...podControlStub,
      mcp: {
        token: async () => held.token,
        begin: async () =>
          args.begin === undefined
            ? { ok: true, url: AUTHORIZE_URL, expiresAt: EXPIRES_AT }
            : await args.begin(),
      },
    },
    append: async (drafts) => {
      appended.push(...(drafts as unknown as Draft[]))
    },
  }
  const store = new McpStore({ ctx, config, connectTimeoutMs: 200, reconcileBudgetMs: 200 })
  await store.boot()
  return {
    appended,
    store,
    tool: new McpSignInTool(ctx, store),
    grant: (token: string) => {
      held.token = token
    },
  }
}

const startedCards = (appended: readonly Draft[]): Draft[] =>
  appended.filter((draft) => draft.type === 'mcp-sign-in-started')

const resolutions = (appended: readonly Draft[]): Draft[] =>
  appended.filter((draft) => draft.type === 'mcp-sign-in-resolved')

describe('operator_mcp_sign_in drawing a card', () => {
  it('answers in plain text and draws nothing when the session has no such server', async () => {
    const restore = stubFetch(unauthorized)
    try {
      const { appended, tool } = await start()

      expect(await tool.invoke(invocation({ name: 'ghost' }))).toEqual({
        ok: false,
        reason: 'no MCP server is named ghost in this session; the mcp view lists the ones it has',
      })
      expect(startedCards(appended)).toEqual([])
    } finally {
      restore()
    }
  })

  it('answers in plain text and draws nothing when the provider refuses to start a flow', async () => {
    const restore = stubFetch(unauthorized)
    try {
      const { appended, tool } = await start({
        begin: async () => ({ ok: false, reason: 'the provider refuses dynamic registration' }),
      })

      expect(await tool.invoke(invocation({ name: 'posthog' }))).toEqual({
        ok: false,
        reason: 'the provider refuses dynamic registration',
      })
      expect(startedCards(appended)).toEqual([])
    } finally {
      restore()
    }
  })

  it('draws a card that carries the link and keeps it out of the text', async () => {
    const restore = stubFetch(unauthorized)
    try {
      const { appended, tool } = await start()

      const outcome = await tool.invoke(invocation({ name: 'posthog' }))

      expect(outcome.ok).toBe(true)
      if (outcome.ok !== true) return
      expect(outcome.modelText).toContain('posthog')
      expect(outcome.modelText).toContain('card')
      expect(outcome.modelText).not.toContain(AUTHORIZE_URL)
      expect(startedCards(appended)).toEqual([
        {
          type: 'mcp-sign-in-started',
          server: 'posthog',
          url: AUTHORIZE_URL,
          expiresAt: EXPIRES_AT,
          sessionId: 's1',
        },
      ])
    } finally {
      restore()
    }
  })
})

describe('operator_mcp_sign_in resolving its card', () => {
  it('says connected once the grant lands and the next turn connects the server', async () => {
    const restore401 = stubFetch(unauthorized)
    const begun = await start()
    await begun.tool.invoke(invocation({ name: 'posthog' }))
    restore401()

    const restoreOk = stubFetch(handshake)
    try {
      begun.grant('token-1')
      await begun.store.reconcile()

      expect(resolutions(begun.appended)).toEqual([
        { type: 'mcp-sign-in-resolved', server: 'posthog', result: 'connected', sessionId: 's1' },
      ])
    } finally {
      restoreOk()
    }
  })

  it('says the link expired when the turn lands after it died', async () => {
    const restore = stubFetch(unauthorized)
    try {
      const { appended, store, tool } = await start({
        begin: async () => ({
          ok: true,
          url: AUTHORIZE_URL,
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      })
      await tool.invoke(invocation({ name: 'posthog' }))
      await store.reconcile()

      expect(resolutions(appended)).toEqual([
        {
          type: 'mcp-sign-in-resolved',
          server: 'posthog',
          result: 'failed',
          sessionId: 's1',
          reason: LINK_EXPIRED_REASON,
        },
      ])
    } finally {
      restore()
    }
  })

  it('resolves a card once and never again', async () => {
    const restore401 = stubFetch(unauthorized)
    const begun = await start()
    await begun.tool.invoke(invocation({ name: 'posthog' }))
    restore401()

    const restoreOk = stubFetch(handshake)
    try {
      begun.grant('token-1')
      await begun.store.reconcile()
      await begun.store.reconcile()

      expect(resolutions(begun.appended)).toHaveLength(1)
    } finally {
      restoreOk()
    }
  })
})
