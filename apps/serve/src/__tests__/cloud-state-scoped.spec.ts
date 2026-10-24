import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EDefinitionOrigin, ESettingId } from '@dltech/atlas-core'
import { encodeSettingValue, FileMcpSource } from '@dltech/atlas-harness'

import { EServeEvent } from '../serve-log'
import { SANDBOX_CONFIG_PATH, sandboxConfigSearch } from './cloud-state-fixture'
import { cleanupCloudState, apply, cloudWith, secretsAt, tempHome } from './cloud-state-harness'

afterEach(cleanupCloudState)

const resolved = {
  settings: { [ESettingId.SidebarWidth]: encodeSettingValue(42) },
  secrets: [
    { name: 'TAVILY_API_KEY', value: 'tvly-scoped', kind: 'secret' },
    { name: 'DATABASE_URL', value: 'postgres://proj', kind: 'env' },
    { name: 'ATLAS_MODEL', value: 'hijack/attempt', kind: 'env' },
  ],
  mcpServers: [
    { name: 'docs', spec: { transport: { kind: 'http', url: 'https://docs.example.com/mcp' } } },
  ],
  provenance: { [`setting:${ESettingId.SidebarWidth}`]: 'project' },
}

describe('applyCloudState against the scoped config endpoint', () => {
  it('writes settings, secrets and mcp.json from one config fetch and skips the legacy pair', async () => {
    const home = tempHome()
    const cloud = cloudWith({ config: resolved, settings: [{ key: 'legacy', value: 'x' }] })

    const lines = await apply({ home, cloud, projectId: 'proj 1' })

    expect(cloud.requests.map((request) => request.path).sort()).toEqual([
      SANDBOX_CONFIG_PATH,
      '/v1/trpc/accountLease.get',
    ])
    const configRequest = cloud.requests.find((request) => request.path === SANDBOX_CONFIG_PATH)
    expect(configRequest?.search).toBe(sandboxConfigSearch('proj 1'))
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toContain(ESettingId.SidebarWidth)
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).not.toContain('legacy')
    expect(secretsAt(home).read('TAVILY_API_KEY')).toBe('tvly-scoped')
    expect(secretsAt(home).read('DATABASE_URL')).toBe('postgres://proj')

    const mcp = await new FileMcpSource({
      file: join(home, 'mcp.json'),
      origin: EDefinitionOrigin.User,
    }).load()
    expect(mcp.rejections).toEqual([])
    expect(mcp.specs.map((spec) => spec.name)).toEqual(['docs'])
    expect(lines[0]).toMatchObject({
      event: EServeEvent.CloudStateReady,
      settings: 1,
      mcpServers: 1,
    })
  })

  it('exports env-kind entries to the process env, never secret-kind or ATLAS_* names, and never overrides', async () => {
    const home = tempHome()
    const env: Record<string, string | undefined> = { TAVILY_API_KEY: undefined }
    await apply({ home, cloud: cloudWith({ config: resolved }), env })

    expect(env.DATABASE_URL).toBe('postgres://proj')
    expect(env.TAVILY_API_KEY).toBeUndefined()
    expect(env.ATLAS_MODEL).toBeUndefined()
    expect(env[ESettingId.SidebarWidth]).toBeUndefined()

    const preset: Record<string, string | undefined> = { DATABASE_URL: 'from-image' }
    await apply({ home: tempHome(), cloud: cloudWith({ config: resolved }), env: preset })
    expect(preset.DATABASE_URL).toBe('from-image')
  })

  it('merges cloud servers into an existing mcp.json, cloud winning by name', async () => {
    const home = tempHome()
    writeFileSync(
      join(home, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          docs: { transport: { kind: 'stdio', command: 'old' } },
          local: { transport: { kind: 'stdio', command: 'keep-me' } },
        },
      }),
    )
    await apply({ home, cloud: cloudWith({ config: resolved }) })
    const written = JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8'))
    expect(written.mcpServers.docs.transport.url).toBe('https://docs.example.com/mcp')
    expect(written.mcpServers.local.transport.command).toBe('keep-me')
  })

  it('omits the projectId query when there is no project', async () => {
    const cloud = cloudWith({ config: resolved })
    await apply({ home: tempHome(), cloud })
    expect(cloud.requests.find((request) => request.path === SANDBOX_CONFIG_PATH)?.search).toBe('')
  })
})
