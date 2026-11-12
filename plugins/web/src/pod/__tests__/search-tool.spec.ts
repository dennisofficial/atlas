import { describe, expect, it } from 'bun:test'

import { EWebSearchBackend, toThreadId } from '@dltech/atlas-core'
import {
  type PluginPodContext,
  type WebSearchConfig,
  EMPTY_MCP_CONTROL,
  EMPTY_OPERATOR_INPUT,
} from '@dltech/atlas-plugin-sdk'

import { keylessBackend, resolveBackend } from '../search'
import { WebSearchTool } from '../search-tool'

const ctxWith = (config: WebSearchConfig): PluginPodContext => {
  const unsupported = (): never => {
    throw new Error('not part of this spec')
  }
  return {
    sessionId: 'ses_42',
    control: {
      exposePort: unsupported,
      memory: {} as never,
      mcp: EMPTY_MCP_CONTROL,
      operator: EMPTY_OPERATOR_INPUT,
      webSearch: { config: async () => config },
    },
    crew: {} as never,
    sessions: {} as never,
    worktrees: {} as never,
    append: unsupported,
    events: () => [],
    call: unsupported,
    live: () => undefined,
    onDaemonEvent: () => () => undefined,
    log: () => undefined,
  }
}

const invoke = (
  tool: WebSearchTool,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; [key: string]: unknown }> =>
  tool.invoke({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'key-1',
    projectDirectory: '/work/repo',
    activeWorktree: undefined,
    threadId: toThreadId('thr_1'),
  }) as Promise<{ ok: boolean; [key: string]: unknown }>

const findings = {
  query: 'atlas agent',
  backend: EWebSearchBackend.Bing,
  results: [{ title: 'Atlas', url: 'https://example.com/atlas', snippet: 'a harness' }],
}

describe('WebSearchTool', () => {
  it('renders the operator backend results inside one envelope', async () => {
    const tool = new WebSearchTool(ctxWith({ backend: 'bing', key: undefined }), {
      searcher: async () => ({ ok: true, findings }),
    })

    const outcome = await invoke(tool, { query: 'atlas agent' })

    expect(outcome.ok).toBe(true)
    expect(String(outcome.modelText)).toContain('https://example.com/atlas')
    expect(String(outcome.modelText)).toContain('untrusted')
  })

  it('asks the backend the setting names and passes its key', async () => {
    const seen: { backend: string | undefined; credential: string | undefined }[] = []
    const tool = new WebSearchTool(ctxWith({ backend: 'brave', key: 'sk-1' }), {
      searcher: async (args) => {
        seen.push({ backend: args.backend, credential: args.credential })
        return { ok: true, findings }
      },
    })

    await invoke(tool, { query: 'atlas' })

    expect(seen).toEqual([{ backend: 'brave', credential: 'sk-1' }])
  })

  it('refuses a keyed backend with no key and names the setting to add', async () => {
    const tool = new WebSearchTool(ctxWith({ backend: 'brave', key: undefined }))
    const outcome = await invoke(tool, { query: 'atlas' })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('web.searchBackend')
    expect(String(outcome.reason)).toContain('search.brave')
  })

  it('refuses a backend name it does not know', async () => {
    const tool = new WebSearchTool(ctxWith({ backend: 'nonesuch', key: undefined }))
    const outcome = await invoke(tool, { query: 'atlas' })

    expect(outcome.ok).toBe(false)
    expect(String(outcome.reason)).toContain('names no backend')
  })
})

describe('search backends', () => {
  it('knows which backends need a key', () => {
    expect(keylessBackend(EWebSearchBackend.Bing)).toBe(true)
    expect(keylessBackend(EWebSearchBackend.Brave)).toBe(false)
  })

  it('resolves a backend name and refuses one it does not know', () => {
    expect(resolveBackend('tavily')).toBe(EWebSearchBackend.Tavily)
    expect(resolveBackend('nonesuch')).toBeUndefined()
    expect(resolveBackend(undefined)).toBeUndefined()
  })
})
