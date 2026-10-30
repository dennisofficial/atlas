import { describe, expect, it } from 'bun:test'

import {
  EConfigScope,
  EMPTY_SCOPE_LAYER,
  EMcpTransportKind,
  podFacingConfig,
  PROJECT_SETTING_REGISTRY,
  resolveScopedConfig,
  resolvedSandboxConfigSchema,
  validateProjectSetting,
  encodeSettingValue,
  userVercelCredentialSchema,
  userVercelCredentialUpsertSchema,
  type ScopedMcpServer,
  type ScopeLayer,
} from '../web'

const layer = (partial: Partial<ScopeLayer>): ScopeLayer => ({ ...EMPTY_SCOPE_LAYER, ...partial })

const server = (url: string): ScopedMcpServer => ({
  name: 'docs',
  spec: { transport: { kind: EMcpTransportKind.Http, url } },
})

describe('resolveScopedConfig', () => {
  it('lets project beat user beat default for one key', () => {
    const resolved = resolveScopedConfig({
      defaults: layer({ settings: { 'model.effort': 'd' } }),
      user: layer({ settings: { 'model.effort': 'u' } }),
      project: layer({ settings: { 'model.effort': 'p' } }),
    })
    expect(resolved.settings['model.effort']).toBe('p')
    expect(resolved.provenance['setting:model.effort']).toBe(EConfigScope.Project)
  })

  it('falls through a missing scope to the next lower one', () => {
    const resolved = resolveScopedConfig({
      defaults: layer({ settings: { a: 'd', b: 'd' } }),
      user: layer({ settings: { a: 'u' } }),
      project: layer({}),
    })
    expect(resolved.settings).toEqual({ a: 'u', b: 'd' })
    expect(resolved.provenance['setting:a']).toBe(EConfigScope.User)
    expect(resolved.provenance['setting:b']).toBe(EConfigScope.Default)
  })

  it('resolves a missing project as user + defaults', () => {
    const resolved = resolveScopedConfig({
      defaults: layer({ settings: { x: 'd' } }),
      user: layer({ secrets: [{ name: 'TOKEN', value: 'u' }] }),
      project: null,
    })
    expect(resolved.settings).toEqual({ x: 'd' })
    expect(resolved.secrets).toEqual([{ name: 'TOKEN', value: 'u' }])
  })

  it('takes the winning entry whole when env and secret kinds clash', () => {
    const resolved = resolveScopedConfig({
      defaults: EMPTY_SCOPE_LAYER,
      user: layer({ secrets: [{ name: 'API', value: 'u' }] }),
      project: layer({ secrets: [{ name: 'API', value: 'p' }] }),
    })
    expect(resolved.secrets).toEqual([{ name: 'API', value: 'p' }])
    expect(resolved.provenance['secret:API']).toBe(EConfigScope.Project)
  })

  it('merges mcp servers by name and sorts every list', () => {
    const resolved = resolveScopedConfig({
      defaults: EMPTY_SCOPE_LAYER,
      user: layer({
        mcpServers: [server('https://u.dev'), { name: 'alpha', spec: { disabled: true } }],
      }),
      project: layer({ mcpServers: [server('https://p.dev')] }),
    })
    expect(resolved.mcpServers.map((entry) => entry.name)).toEqual(['alpha', 'docs'])
    expect(resolved.mcpServers[1]).toEqual(server('https://p.dev'))
    expect(resolvedSandboxConfigSchema.safeParse(resolved).success).toBe(true)
  })

  it('strips sandbox.vercel* settings and secrets from the pod-facing view', () => {
    const resolved = resolveScopedConfig({
      defaults: EMPTY_SCOPE_LAYER,
      user: layer({ settings: { 'sandbox.vercelTeamId': 't', 'model.id': 'a/b' } }),
      project: layer({
        settings: { 'sandbox.vercelProjectId': 'prj' },
        secrets: [{ name: 'sandbox.vercelToken', value: 'tok' }],
      }),
    })
    const pod = podFacingConfig(resolved)
    expect(pod.settings).toEqual({ 'model.id': 'a/b' })
    expect(pod.secrets).toEqual([])
    expect(Object.keys(pod.provenance)).toEqual(['setting:model.id'])
    expect(JSON.stringify(pod)).not.toContain('vercel')
  })
})

describe('harness secrets in the resolved config', () => {
  it('passes the user layer through sorted and ignores the project layer', () => {
    const resolved = resolveScopedConfig({
      defaults: EMPTY_SCOPE_LAYER,
      user: layer({
        harnessSecrets: [
          { name: 'search.jina', value: 'j' },
          { name: 'decisions.token.openai', value: 'o' },
        ],
      }),
      project: layer({ harnessSecrets: [{ name: 'search.exa', value: 'e' }] }),
    })
    expect(resolved.harnessSecrets.map((secret) => secret.name)).toEqual([
      'decisions.token.openai',
      'search.jina',
    ])
    expect(resolved.secrets).toEqual([])
  })

  it('strips sandbox.vercel* harness secrets from the pod-facing view', () => {
    const pod = podFacingConfig(
      resolveScopedConfig({
        defaults: EMPTY_SCOPE_LAYER,
        user: layer({
          harnessSecrets: [
            { name: 'sandbox.vercelToken', value: 'tok' },
            { name: 'search.jina', value: 'j' },
          ],
        }),
        project: null,
      }),
    )
    expect(pod.harnessSecrets).toEqual([{ name: 'search.jina', value: 'j' }])
  })
})

describe('project setting registry', () => {
  it('holds harness keys and no vercel provisioning key, and rejects unknown keys', () => {
    expect(PROJECT_SETTING_REGISTRY.has('sandbox.vercelProjectId')).toBe(false)
    expect(PROJECT_SETTING_REGISTRY.has('model.id')).toBe(true)
    expect(PROJECT_SETTING_REGISTRY.has('sandbox.vercelTeamId')).toBe(false)
    expect(PROJECT_SETTING_REGISTRY.has('sandbox.vercelToken')).toBe(false)
    expect(
      validateProjectSetting({
        key: 'sandbox.vercelProjectId',
        stored: encodeSettingValue('prj_1'),
      }).ok,
    ).toBe(false)
    expect(validateProjectSetting({ key: 'nope', stored: 'x' }).ok).toBe(false)
  })
})

describe('vercel credential', () => {
  it('reads without a token and takes an optional write-only token beside team and project', () => {
    expect(
      userVercelCredentialSchema.safeParse({
        configured: false,
        teamId: null,
        vercelProjectId: null,
        updatedAt: null,
      }).success,
    ).toBe(true)
    const owned = { teamId: 'team_1', vercelProjectId: 'prj_1' }
    expect(userVercelCredentialUpsertSchema.safeParse(owned).success).toBe(true)
    expect(userVercelCredentialUpsertSchema.safeParse({ ...owned, token: 'v' }).success).toBe(true)
    expect(userVercelCredentialUpsertSchema.safeParse({ ...owned, token: '' }).success).toBe(false)
    expect(
      userVercelCredentialUpsertSchema.safeParse({ token: 'v', teamId: 'team_1' }).success,
    ).toBe(false)
    expect(userVercelCredentialUpsertSchema.safeParse({ token: 'v' }).success).toBe(false)
  })
})
