import { afterEach, describe, expect, it } from 'bun:test'

import { toThreadId, type ToolDefinition } from '@dltech/atlas-core'

import { createIsolatedContainer, portToken } from '../../../container/injection'
import { ClientVersionToken } from '../../../container/tokens'
import { NativePlugin, type PluginContribution } from '../../plugin'
import FactoryPlugin, { EFactoryRole, registerPlugin } from '../index'

const ENV_KEYS = ['ATLAS_FACTORY_ROLE', 'ATLAS_CLOUD_URL', 'ATLAS_SERVE_TOKEN'] as const

const saved: (string | undefined)[] = ENV_KEYS.map((key) => process.env[key])

afterEach(() => {
  ENV_KEYS.forEach((key, index) => {
    const value = saved[index]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
})

const setEnv = (env: Partial<Record<(typeof ENV_KEYS)[number], string>>): void => {
  for (const key of ENV_KEYS) {
    const value = env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const FACTORY_ENV = {
  ATLAS_CLOUD_URL: 'https://api.byatlas.io',
  ATLAS_SERVE_TOKEN: 'atlas_serve_token',
} as const

const resolved = async (
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
): Promise<{ plugin: FactoryPlugin; contribution: PluginContribution }> => {
  setEnv(env)
  const container = createIsolatedContainer()
  container.register(ClientVersionToken, { useValue: 'test' })
  registerPlugin({ container })

  const plugin = container.resolve(portToken(NativePlugin))
  if (!(plugin instanceof FactoryPlugin)) throw new Error('the container answered something else')

  return { plugin, contribution: await plugin.contribute() }
}

const toolNames = (contribution: PluginContribution): string[] =>
  (contribution.tools ?? []).map((tool) => tool.name)

const ORCHESTRATOR_TOOLS = [
  'factory_reply',
  'factory_spawn_station',
  'factory_steer_station',
  'factory_stop_station',
  'factory_deliver',
  'github_get_issue',
  'github_get_comments',
  'github_get_pull_request',
  'github_get_diff',
  'github_close_issue',
  'github_add_label',
  'github_remove_label',
  'linear_get_issue',
  'linear_comment',
  'linear_set_state',
  'linear_mark_duplicate',
]

describe('the factory plugin as the loader sees it', () => {
  it('is a native the container can build from its id alone', async () => {
    expect((await resolved({})).plugin.id).toBe('factory')
  })

  it('contributes nothing when ATLAS_FACTORY_ROLE is absent', async () => {
    const { contribution } = await resolved({ ...FACTORY_ENV })

    expect(contribution.tools ?? []).toEqual([])
    expect(contribution.hooks ?? []).toEqual([])
  })

  it('contributes nothing when ATLAS_FACTORY_ROLE is not a known role', async () => {
    const { contribution } = await resolved({ ...FACTORY_ENV, ATLAS_FACTORY_ROLE: 'janitor' })

    expect(contribution.tools ?? []).toEqual([])
  })

  it('contributes nothing when the role is set but the serve token is missing', async () => {
    const { contribution } = await resolved({
      ATLAS_FACTORY_ROLE: 'orchestrator',
      ATLAS_CLOUD_URL: 'https://api.byatlas.io',
    })

    expect(contribution.tools ?? []).toEqual([])
  })

  it('contributes the orchestrator set to an orchestrator session', async () => {
    const { contribution } = await resolved({ ...FACTORY_ENV, ATLAS_FACTORY_ROLE: 'orchestrator' })

    expect(toolNames(contribution)).toEqual(ORCHESTRATOR_TOOLS)
  })

  it('contributes the station set to a station session', async () => {
    const { contribution } = await resolved({ ...FACTORY_ENV, ATLAS_FACTORY_ROLE: 'station' })

    expect(toolNames(contribution)).toEqual(['factory_submit_result', 'factory_git_token'])
  })
})

describe('a contributed tool end to end', () => {
  const pluginWith = (fetchFn: typeof fetch): FactoryPlugin =>
    new FactoryPlugin({
      role: EFactoryRole.Orchestrator,
      url: 'https://api.byatlas.io',
      token: 'atlas_serve_token',
      clientVersion: 'test',
      fetchFn,
    })

  const toolNamed = (plugin: FactoryPlugin, name: string): ToolDefinition => {
    const tool = plugin.contribute().tools?.find((entry) => entry.name === name)
    if (tool === undefined) throw new Error(`no tool named ${name} was contributed`)
    return tool
  }

  const invocation = (input: unknown) => ({
    input,
    signal: new AbortController().signal,
    idempotencyKey: 'idem-1',
    projectDirectory: '/work/atlas',
    threadId: toThreadId('thread-1'),
  })

  it('factory_reply posts to the control plane and hands back the parsed JSON', async () => {
    const seen: string[] = []
    const fetchFn = (async (input: string | URL | Request) => {
      seen.push(String(input))
      return new Response(JSON.stringify({ id: 'reply-1' }), { status: 200 })
    }) as typeof fetch

    const outcome = await toolNamed(pluginWith(fetchFn), 'factory_reply').invoke(
      invocation({ surface: 'github', externalId: '12', body: 'on it' }),
    )

    expect(seen).toEqual(['https://api.byatlas.io/v1/factory/replies'])
    expect(outcome).toEqual({ ok: true, output: { id: 'reply-1' }, modelText: '{\n  "id": "reply-1"\n}' })
  })

  it('a control-plane refusal reads as a failed outcome, not a throw', async () => {
    const fetchFn = (async (_input: string | URL | Request) =>
      new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 })) as typeof fetch

    const outcome = await toolNamed(pluginWith(fetchFn), 'factory_reply').invoke(
      invocation({ surface: 'github', externalId: '12', body: 'on it' }),
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('rate limited')
  })

  it('rejects input carrying keys the schema does not declare', async () => {
    const fetchFn = (async (_input: string | URL | Request) =>
      new Response('{}', { status: 200 })) as typeof fetch

    const outcome = await toolNamed(pluginWith(fetchFn), 'factory_reply').invoke(
      invocation({ surface: 'github', externalId: '12', body: 'on it', extra: 'nope' }),
    )

    expect(outcome.ok).toBe(false)
  })
})
