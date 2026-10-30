import { describe, expect, it } from 'bun:test'

import { ECommand, ECommandEffect } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-client/channel'

import { isSignInArgument, MCP_SETTINGS_HINT, NO_MCP_SERVERS_NOTICE } from '../mcp-notice'
import { newThreadCommandHandlers } from '../new-thread-command-handlers'
import { webCommandHandlers, type CommandDeps } from '../web-command-handlers'

const depsReplying = (reply: unknown) => {
  const calls: { op: EClientRequest; params: unknown }[] = []
  const deps: CommandDeps = {
    threadId: 'thr_1',
    request: (call) => {
      calls.push(call)
      return Promise.resolve(reply)
    },
    operationId: () => 'op_1',
    openModelPicker: () => undefined,
    openSearch: () => undefined,
    openDetails: () => undefined,
    navigate: () => undefined,
    wake: async () => undefined,
    reloadSkills: async () => 0,
  }
  return { deps, calls }
}

const run = (handlers: ReturnType<typeof webCommandHandlers>, argumentText: string) => {
  const handler = handlers[ECommand.Mcp]
  if (handler === undefined) throw new Error('no mcp handler')
  return handler({ argumentText } as never)
}

describe('web /mcp', () => {
  it('lists servers with status, tool count and a settings hint for needs-auth', async () => {
    const { deps, calls } = depsReplying({
      servers: [
        { name: 'linear', transport: 'http', status: 'connected', toolCount: 1 },
        { name: 'posthog', transport: 'http', status: 'needs-auth', toolCount: 0 },
      ],
    })

    const effect = await run(webCommandHandlers(deps), '')

    expect(calls).toEqual([{ op: EClientRequest.ListMcpServers, params: { refresh: true } }])
    expect(effect).toEqual({
      type: ECommandEffect.Ran,
      notice: `linear — connected (1 tool)\nposthog — needs-auth (0 tools) — ${MCP_SETTINGS_HINT}`,
    })
  })

  it('says so when nothing is configured', async () => {
    const { deps } = depsReplying({ servers: [] })

    expect(await run(webCommandHandlers(deps), '')).toEqual({
      type: ECommandEffect.Ran,
      notice: NO_MCP_SERVERS_NOTICE,
    })
  })

  it('points sign-in at Settings without asking the sandbox', async () => {
    const { deps, calls } = depsReplying({ servers: [] })

    const effect = await run(webCommandHandlers(deps), 'signin posthog')

    expect(calls).toEqual([])
    expect(effect).toEqual({ type: ECommandEffect.Ran, notice: MCP_SETTINGS_HINT })
  })

  it('gives the new-thread surface the same hint', async () => {
    const handlers = newThreadCommandHandlers({
      openModelPicker: () => undefined,
      openSearch: () => undefined,
      navigate: () => undefined,
      clearDraft: () => undefined,
      reloadSkills: async () => 0,
    })

    expect(await run(handlers, '')).toEqual({ type: ECommandEffect.Ran, notice: MCP_SETTINGS_HINT })
  })
})

describe('isSignInArgument', () => {
  it('matches only a first token of exactly signin', () => {
    expect(isSignInArgument('signin posthog')).toBe(true)
    expect(isSignInArgument('  SignIn')).toBe(true)
    expect(isSignInArgument('signing')).toBe(false)
    expect(isSignInArgument('signinfoo bar')).toBe(false)
    expect(isSignInArgument('')).toBe(false)
  })
})
