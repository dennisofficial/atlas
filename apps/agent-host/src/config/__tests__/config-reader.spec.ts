import { describe, expect, it } from 'bun:test'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { VercelReconnectRequiredError } from '../../tokens/vercel-token-refresher'
import { ConfigReader, SessionNotFoundError } from '../config-reader'
import {
  cipher,
  recordingDb,
  seedApiKeyAccount,
  seedOwner,
  seedSetting,
  seedSkill,
  seedVercel,
} from './config-reader.fixture'

const testDb = useTestDatabase()
const NOW = Date.parse('2026-11-05T12:00:00.000Z')
const noRefresh = { refresh: async (): Promise<string> => 'refreshed-token' }
const readerOver = (
  db = testDb().db,
  vercel: { refresh(a: { userId: string }): Promise<string> } = noRefresh,
) => new ConfigReader({ db, cipher, vercel, now: () => NOW })

describe('ConfigReader', () => {
  it('reads workspace, vercel credentials and the model choice for a session', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    await seedApiKeyAccount(db)
    await seedSetting({ db, scope: 'user', value: 'anthropic/claude-sonnet-4-5' })
    const config = await readerOver().read({ sessionId: 's-1' })
    expect(config.userId).toBe('user-1')
    expect(config.projectId).toBe('proj-1')
    expect(config.workspace).toEqual({
      remoteUrl: 'https://github.com/acme/app.git',
      baseBranch: 'main',
      additionalRepos: [{ repo: 'acme/lib', branch: 'dev' }],
      setupScript: 'bun install',
    })
    expect(config.vercel).toEqual({
      configured: true,
      token: 'vercel-token',
      teamId: 'team-1',
      projectId: 'vproj-1',
    })
    expect(config.model).toEqual({
      configured: true,
      modelId: 'claude-sonnet-4-5',
      accountId: 'acct-1',
      credential: { kind: 'api-key', apiKey: 'sk-test' },
    })
  })

  it('lets a project setting override the user model and falls back to the shipped default', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    expect((await readerOver().read({ sessionId: 's-1' })).model).toMatchObject({
      modelId: 'claude-haiku-4-5',
    })
    await seedSetting({ db, scope: 'user', value: 'anthropic/claude-sonnet-4-5' })
    await seedSetting({ db, scope: 'project', value: 'anthropic/claude-opus-4-1' })
    expect((await readerOver().read({ sessionId: 's-1' })).model).toMatchObject({
      modelId: 'claude-opus-4-1',
    })
  })

  it('reports gaps when nothing is connected', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const config = await readerOver().read({ sessionId: 's-1' })
    expect(config.vercel).toEqual({ configured: false, gap: 'user-credential' })
    expect(config.model).toEqual({ configured: false, gap: 'no anthropic account' })
  })

  it('refreshes a near-expiry oauth vercel token instead of reporting a gap', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db, { kind: 'oauth', accessTokenExpiresAt: new Date(NOW + 30_000) })
    expect((await readerOver().read({ sessionId: 's-1' })).vercel).toEqual({
      configured: true,
      token: 'refreshed-token',
      teamId: 'team-1',
      projectId: 'vproj-1',
    })
    const reconnect = {
      refresh: async (): Promise<string> => {
        throw new VercelReconnectRequiredError()
      },
    }
    expect((await readerOver(db, reconnect).read({ sessionId: 's-1' })).vercel).toEqual({
      configured: false,
      gap: 'vercel-reconnect-required',
    })
    const down = {
      refresh: async (): Promise<string> => {
        throw new Error('vercel down')
      },
    }
    expect((await readerOver(db, down).read({ sessionId: 's-1' })).vercel).toEqual({
      configured: false,
      gap: 'vercel-oauth-refresh-required',
    })
    await db.orm.public.UserVercelCredential.where({ userId: 'user-1' }).updateAndCount({
      accessTokenExpiresAt: new Date(NOW + 600_000),
    })
    expect((await readerOver().read({ sessionId: 's-1' })).vercel).toMatchObject({
      configured: true,
    })
  })

  it('throws a typed error for an unknown session', async () => {
    await expect(readerOver().read({ sessionId: 'missing' })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    )
  })

  it('returns the skill index by name with scope and never touches SkillFile', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedSkill({ db, name: 'zeta', scope: 'user' })
    await seedSkill({ db, name: 'alpha', scope: 'project', description: 'does alpha' })
    await seedSkill({ db, name: 'mid', scope: 'user' })
    const recording = recordingDb({ url: testDb().url })
    const config = await readerOver(recording.db).read({ sessionId: 's-1' })
    await recording.end()
    expect(config.skills).toEqual([
      { name: 'alpha', description: 'does alpha', scope: 'project' },
      { name: 'mid', description: 'mid description', scope: 'user' },
      { name: 'zeta', description: 'zeta description', scope: 'user' },
    ])
    expect(recording.sql.length).toBeGreaterThan(0)
    expect(recording.sql.some((text) => text.includes('SkillFile'))).toBe(false)
    expect(recording.sql.some((text) => text.includes('"Skill"'))).toBe(true)
  })
})
