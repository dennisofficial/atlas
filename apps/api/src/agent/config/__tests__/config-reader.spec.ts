import { describe, expect, it } from 'bun:test'
import { EEffort } from '@dltech/atlas-core'
import { ECredentialSource, ESandboxProvider } from '@dltech/atlas-protocol'
import { ControlPlane } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { useTestDatabase } from '@dltech/atlas-db/testing'

import { ConfigReader, SessionNotFoundError } from '../config-reader'
import type { SandboxConfig } from '../agent-host-config'
import type { AgentHostEnv } from '../env'
import {
  cipher,
  recordingDb,
  sealed,
  seedApiKeyAccount,
  seedOwner,
  seedSetting,
  seedSkill,
  seedVercel,
} from './config-reader.fixture'

const testDb = useTestDatabase()
const NOW = Date.parse('2026-11-05T12:00:00.000Z')
const NO_PLATFORM: Pick<AgentHostEnv, 'platformVercel' | 'agent37'> = {
  platformVercel: null,
  agent37: null,
}
const PLATFORM: Pick<AgentHostEnv, 'platformVercel' | 'agent37'> = {
  platformVercel: { token: 'platform-token', teamId: 'platform-team', projectId: 'platform-proj' },
  agent37: {
    apiKey: 'a37-platform-key',
    template: 'atlas-sandbox@3',
    resources: { cpu: 2, memory: 4, disk: 20 },
  },
}
const readerOver = (
  db = testDb().db,
  platform: Pick<AgentHostEnv, 'platformVercel' | 'agent37'> = NO_PLATFORM,
) => new ConfigReader({ db, cipher, platform, now: () => NOW })

const vcpusOf = (sandbox: SandboxConfig): number | undefined =>
  sandbox.configured ? sandbox.vcpus : undefined

const diskGbOf = (sandbox: SandboxConfig): number | undefined =>
  sandbox.configured ? sandbox.diskGb : undefined

describe('ConfigReader', () => {
  it('reads workspace, platform credentials and the model choice for a session', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await seedSetting({ db, scope: 'user', value: 'anthropic/claude-sonnet-4-5' })
    const config = await readerOver(db, PLATFORM).read({ sessionId: 's-1' })
    expect(config.userId).toBe('user-1')
    expect(config.projectId).toBe('proj-1')
    expect(config.sandbox.provider).toBe(ESandboxProvider.Vercel)
    expect(config.workspace).toEqual({
      remoteUrl: 'https://github.com/acme/app.git',
      baseBranch: 'main',
      additionalRepos: [{ repo: 'acme/lib', branch: 'dev' }],
      setupScript: 'bun install',
    })
    expect(config.sandbox).toEqual({
      configured: true,
      provider: ESandboxProvider.Vercel,
      credentials: {
        provider: ESandboxProvider.Vercel,
        token: 'platform-token',
        teamId: 'platform-team',
        projectId: 'platform-proj',
      },
    })
    expect(config.model).toEqual({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      effort: EEffort.Medium,
      fast: false,
      accountId: 'acct-1',
      credential: { kind: 'api-key', apiKey: 'sk-test' },
    })
  })

  it('reads the sandbox provider pinned on the session', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await new ControlPlane({ store: new PostgresControlStore(db) }).createSession({
      sessionId: 's-agent37',
      userId: 'user-1',
      projectId: 'proj-1',
      mainThreadId: 't-agent37',
      sandboxProvider: ESandboxProvider.Agent37,
    })
    const config = await readerOver(db, PLATFORM).read({ sessionId: 's-agent37' })
    expect(config.sandbox.provider).toBe(ESandboxProvider.Agent37)
  })

  it('reports a retired gap for a session still pinned to its owner byok credential', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({
      credentialSource: ECredentialSource.Byok,
    })
    expect((await readerOver(db, PLATFORM).read({ sessionId: 's-1' })).sandbox).toEqual({
      configured: false,
      provider: ESandboxProvider.Vercel,
      gap: 'byok-retired',
    })
  })

  it('runs the model the session names, over the configured default', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    await seedApiKeyAccount(db)
    await seedApiKeyAccount({ db, id: 'acct-2', provider: 'openai', apiKey: 'sk-openai' })
    await seedSetting({ db, scope: 'user', value: 'anthropic/claude-sonnet-4-5' })
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({
      modelRef: 'openai/gpt-5',
      modelEffort: 'low',
      modelFast: true,
    })
    const config = await readerOver().read({ sessionId: 's-1' })
    expect(config.model).toEqual({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      fast: false,
      accountId: 'acct-2',
      credential: { kind: 'api-key', apiKey: 'sk-openai' },
    })
  })

  it('resolves every role from the same settings, project over user', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    await seedApiKeyAccount(db)
    await seedApiKeyAccount({ db, id: 'acct-2', provider: 'openai', apiKey: 'sk-openai' })
    await seedSetting({
      db,
      scope: 'user',
      key: 'agents.type.builder',
      value: 'anthropic/claude-sonnet-4-5',
    })
    await seedSetting({ db, scope: 'project', key: 'agents.type.builder', value: 'openai/gpt-5' })
    await seedSetting({ db, scope: 'user', key: 'agents.type.teammate', value: 'openai/gpt-5' })
    const config = await readerOver().read({ sessionId: 's-1' })
    expect(config.models.main.config).toMatchObject({
      ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
      accountId: 'acct-1',
    })
    expect(config.models.resolve({ role: { agentType: 'builder' } }).config).toMatchObject({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      accountId: 'acct-2',
    })
    expect(
      config.models.resolve({ role: { agentType: 'teammate' }, root: config.models.main.choice })
        .config,
    ).toMatchObject({ ref: { providerId: 'openai', modelId: 'gpt-5' }, accountId: 'acct-2' })
  })

  it('reports gaps when nothing is connected', async () => {
    const { db } = testDb()
    await seedOwner(db)
    const config = await readerOver().read({ sessionId: 's-1' })
    expect(config.sandbox).toEqual({
      configured: false,
      provider: ESandboxProvider.Vercel,
      gap: 'platform-credential',
    })
    expect(config.model).toEqual({ configured: false, gap: 'no model account' })
  })

  it('reads platform credentials from the env without touching UserVercelCredential', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    const recording = recordingDb({ url: testDb().url })
    const config = await readerOver(recording.db, PLATFORM).read({ sessionId: 's-1' })
    await recording.end()
    expect(config.sandbox).toEqual({
      configured: true,
      provider: ESandboxProvider.Vercel,
      credentials: {
        provider: ESandboxProvider.Vercel,
        token: 'platform-token',
        teamId: 'platform-team',
        projectId: 'platform-proj',
      },
    })
    expect(recording.sql.some((text) => text.includes('"UserVercelCredential"'))).toBe(false)
  })

  it('reads the platform agent37 key for a session pinned to agent37', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({
      sandboxProvider: ESandboxProvider.Agent37,
    })
    expect((await readerOver(db, PLATFORM).read({ sessionId: 's-1' })).sandbox).toEqual({
      configured: true,
      provider: ESandboxProvider.Agent37,
      credentials: { provider: ESandboxProvider.Agent37, apiKey: 'a37-platform-key' },
    })
  })

  it('reports a platform gap when the env holds no credential for the pinned provider', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    expect((await readerOver().read({ sessionId: 's-1' })).sandbox).toEqual({
      configured: false,
      provider: ESandboxProvider.Vercel,
      gap: 'platform-credential',
    })
  })

  it.each([
    { name: "uses the session project's size", project: 4, personal: 8, want: 4 },
    {
      name: "falls through to the owner's sandbox.vcpus setting",
      project: null,
      personal: 8,
      want: 8,
    },
    {
      name: 'leaves the size to Vercel when neither layer sets one',
      project: null,
      personal: null,
      want: undefined,
    },
    {
      name: 'ignores a personal value outside the Vercel pod sizes',
      project: null,
      personal: 3,
      want: undefined,
    },
  ])('sizes the pod: $name', async ({ project, personal, want }) => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    if (project !== null) {
      await db.orm.public.Project.where({ id: 'proj-1' }).update({ sandboxVcpus: project })
    }
    if (personal !== null) {
      await seedSetting({ db, scope: 'user', key: 'sandbox.vcpus', value: personal })
    }
    const config = await readerOver(db, PLATFORM).read({ sessionId: 's-1' })
    expect(vcpusOf(config.sandbox)).toBe(want)
  })

  it('takes the personal sandbox size over a project-scoped setting of the same key', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await seedSetting({ db, scope: 'user', key: 'sandbox.vcpus', value: 8 })
    await seedSetting({ db, scope: 'project', key: 'sandbox.vcpus', value: 2 })
    const config = await readerOver(db, PLATFORM).read({ sessionId: 's-1' })
    expect(vcpusOf(config.sandbox)).toBe(8)
  })

  it.each([
    { name: "uses the session project's disk", project: 40, personal: 80, want: 40 },
    {
      name: "falls through to the owner's sandbox.diskGb setting",
      project: null,
      personal: 60,
      want: 60,
    },
    {
      name: 'leaves the disk to the configured default when neither layer sets one',
      project: null,
      personal: null,
      want: undefined,
    },
    {
      name: 'ignores a personal value outside the disk sizes',
      project: null,
      personal: 25,
      want: undefined,
    },
  ])('sizes the pod disk: $name', async ({ project, personal, want }) => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    if (project !== null) {
      await db.orm.public.Project.where({ id: 'proj-1' }).update({ sandboxDiskGb: project })
    }
    if (personal !== null) {
      await seedSetting({ db, scope: 'user', key: 'sandbox.diskGb', value: personal })
    }
    const config = await readerOver(db, PLATFORM).read({ sessionId: 's-1' })
    expect(diskGbOf(config.sandbox)).toBe(want)
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

  it('runs a session with no project in an empty scratch workspace', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await seedApiKeyAccount({ db, id: 'acct-oa', provider: 'openai', apiKey: 'sk-oa' })
    await seedSetting({
      db,
      scope: 'user',
      key: 'agents.type.builder',
      value: 'anthropic/claude-sonnet-4-5',
    })
    await seedSetting({ db, scope: 'project', key: 'agents.type.builder', value: 'openai/gpt-5' })
    await seedSkill({ db, name: 'user-one', scope: 'user' })
    await seedSkill({ db, name: 'project-one', scope: 'project' })
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({ projectId: null })
    const recording = recordingDb({ url: testDb().url })
    const config = await readerOver(recording.db).read({ sessionId: 's-1' })
    await recording.end()
    expect(config.projectId).toBeNull()
    expect(config.workspace).toEqual({
      remoteUrl: null,
      baseBranch: null,
      additionalRepos: [],
      setupScript: '',
    })
    expect(config.skills).toEqual([
      { name: 'user-one', description: 'user-one description', scope: 'user' },
    ])
    expect(config.models.resolve({ role: { agentType: 'builder' } }).config).toMatchObject({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
      accountId: 'acct-1',
    })
    expect(recording.sql.some((text) => text.includes('"Project"'))).toBe(false)
    expect(recording.sql.some((text) => text.includes('"ProjectSetting"'))).toBe(false)
  })

  it('reads a role model, its effort and its fast setting, project over user', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await seedApiKeyAccount({ db, id: 'acct-oa', provider: 'openai', apiKey: 'sk-oa' })
    await seedSetting({ db, scope: 'user', key: 'agents.type.builder', value: 'openai/gpt-5' })
    await seedSetting({ db, scope: 'user', key: 'agents.type.builder.effort', value: 'high' })
    await seedSetting({ db, scope: 'project', key: 'agents.type.builder.fast', value: true })
    const config = await readerOver().read({ sessionId: 's-1' })
    expect(config.models.resolve({ role: { agentType: 'builder' } }).config).toEqual({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.High,
      fast: false,
      accountId: 'acct-oa',
      credential: { kind: 'api-key', apiKey: 'sk-oa' },
    })
  })
})

describe('ConfigReader model read', () => {
  it('follows an ActiveAccount move to another account of the same provider', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await db.orm.public.AgentAccount.create({
      id: 'acct-2',
      userId: 'user-1',
      provider: 'anthropic',
      kind: 'oauth',
      origin: 'login',
      label: 'two',
      status: 'active',
      sealedSecret: sealed({
        kind: 'oauth',
        tokens: {
          accessToken: 'two',
          refreshToken: 'two-refresh',
          expiresAt: '2026-11-06T12:00:00.000Z',
        },
        authority: { url: 'https://cloud.test', connectionId: 'conn-2' },
      }),
    })
    expect((await readerOver().models({ sessionId: 's-1' })).main.config).toMatchObject({
      configured: true,
      accountId: 'acct-1',
      credential: { kind: 'api-key', apiKey: 'sk-test' },
    })
    await db.orm.public.ActiveAccount.where({ userId: 'user-1', provider: 'anthropic' }).update({
      accountId: 'acct-2',
    })
    expect((await readerOver().models({ sessionId: 's-1' })).main.config).toMatchObject({
      configured: true,
      accountId: 'acct-2',
      credential: { kind: 'oauth', connectionId: 'conn-2' },
    })
  })

  it("follows a mid-session model change to the session's ref, effort and fast", async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await seedApiKeyAccount({ db, id: 'acct-oa', provider: 'openai', apiKey: 'sk-oa' })
    expect((await readerOver().models({ sessionId: 's-1' })).main.config).toMatchObject({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-haiku-4-5' },
    })
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({
      modelRef: 'openai/gpt-5',
      modelEffort: 'low',
    })
    expect((await readerOver().models({ sessionId: 's-1' })).main.config).toMatchObject({
      configured: true,
      ref: { providerId: 'openai', modelId: 'gpt-5' },
      effort: EEffort.Low,
      accountId: 'acct-oa',
    })
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({
      modelRef: 'anthropic/claude-opus-5',
      modelFast: true,
    })
    expect((await readerOver().models({ sessionId: 's-1' })).main.config).toMatchObject({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-opus-5' },
      fast: true,
      accountId: 'acct-1',
    })
  })

  it('keeps an existing session on its model after the default setting changes', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedApiKeyAccount(db)
    await seedApiKeyAccount({ db, id: 'acct-oa', provider: 'openai', apiKey: 'sk-oa' })
    await db.orm.v2.V2Session.where({ id: 's-1' }).update({
      modelRef: 'anthropic/claude-opus-5',
      modelEffort: 'low',
      modelFast: false,
    })
    await seedSetting({ db, scope: 'user', value: 'anthropic/claude-sonnet-4-5' })
    await seedSetting({ db, scope: 'user', key: 'model.effort', value: 'high' })
    await seedSetting({ db, scope: 'user', key: 'model.fast', value: true })
    expect((await readerOver().models({ sessionId: 's-1' })).main.config).toMatchObject({
      configured: true,
      ref: { providerId: 'anthropic', modelId: 'claude-opus-5' },
      effort: EEffort.Low,
      fast: false,
      accountId: 'acct-1',
    })
  })

  it.each([
    { name: "uses the session project's size", project: 4, personal: 8, want: 4 },
    {
      name: "falls through to the owner's sandbox.vcpus setting",
      project: null,
      personal: 8,
      want: 8,
    },
    {
      name: 'leaves the size to Vercel when neither layer sets one',
      project: null,
      personal: null,
      want: undefined,
    },
    {
      name: 'ignores a personal value outside the Vercel pod sizes',
      project: null,
      personal: 3,
      want: undefined,
    },
  ])('sizes the pod: $name', async ({ project, personal, want }) => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    await seedApiKeyAccount(db)
    if (project !== null) {
      await db.orm.public.Project.where({ id: 'proj-1' }).update({ sandboxVcpus: project })
    }
    if (personal !== null) {
      await seedSetting({ db, scope: 'user', key: 'sandbox.vcpus', value: personal })
    }
    expect(vcpusOf((await readerOver(db, PLATFORM).read({ sessionId: 's-1' })).sandbox)).toBe(want)
  })

  it('takes the personal sandbox size over a project-scoped setting of the same key', async () => {
    const { db } = testDb()
    await seedOwner(db)
    await seedVercel(db)
    await seedApiKeyAccount(db)
    await seedSetting({ db, scope: 'user', key: 'sandbox.vcpus', value: 8 })
    await seedSetting({ db, scope: 'project', key: 'sandbox.vcpus', value: 2 })
    expect(vcpusOf((await readerOver(db, PLATFORM).read({ sessionId: 's-1' })).sandbox)).toBe(8)
  })

  it('throws a typed error for an unknown session', async () => {
    await expect(readerOver().models({ sessionId: 'missing' })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    )
  })
})
