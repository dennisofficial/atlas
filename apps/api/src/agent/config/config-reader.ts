import { z } from 'zod'
import type { Db } from '@dltech/atlas-db'
import { decodeSettingValue, validateCloudSetting } from '@dltech/atlas-core'
import { ECredentialSource, ESandboxProvider } from '@dltech/atlas-protocol'

import type {
  AgentHostConfig,
  ConfigSource,
  SandboxConfig,
  VercelConfig,
  WorkspaceConfig,
} from './agent-host-config'
import type { AgentHostEnv } from './env'
import {
  modelSourceOf,
  type ActiveAccountRow,
  type AccountRow,
  type ModelSource,
} from './model-config'
import type { SecretCipher } from './secret-cipher'
import { skillIndexOf } from './skill-index'
import { platformCredentialsOf } from './platform-credentials'
import { VercelReconnectRequiredError } from '../tokens/vercel-token-refresher'

const OAUTH_EXPIRY_MARGIN_MS = 60_000

type ModelChoiceRow = {
  modelRef: string
  modelEffort: string
  modelFast: boolean
  sandboxProvider: string
  credentialSource: string
}

const sandboxProviderOf = (pinned: string | null | undefined): ESandboxProvider => {
  const value = pinned?.trim() ?? ''
  if (value === '') return ESandboxProvider.Vercel
  return z.nativeEnum(ESandboxProvider).parse(value)
}

const repoSchema = z.object({ repo: z.string().min(1), branch: z.string().min(1).optional() })

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session ${sessionId} not found`)
    this.name = 'SessionNotFoundError'
  }
}

type VercelRow = {
  kind: string
  sealedToken: string
  teamId: string
  vercelProjectId: string | null
  accessTokenExpiresAt: Date | null
  oauthNeedsReconnect: boolean
}

type ProjectRow = {
  repo: string | null
  baseBranch: string | null
  additionalRepos: unknown
  setupScript: string
  sandboxVcpus: number | null
}

const SANDBOX_VCPUS_KEY = 'sandbox.vcpus'

const workspaceOf = (project: ProjectRow | null): WorkspaceConfig => {
  if (project === null)
    return { remoteUrl: null, baseBranch: null, additionalRepos: [], setupScript: '' }
  return {
    remoteUrl: project.repo === null ? null : `https://github.com/${project.repo}.git`,
    baseBranch: project.baseBranch,
    additionalRepos: z.array(repoSchema).catch([]).parse(project.additionalRepos),
    setupScript: project.setupScript,
  }
}

export class ConfigReader implements ConfigSource {
  private readonly now: () => number

  constructor(
    private readonly args: {
      db: Db
      cipher: SecretCipher
      vercel: { refresh(args: { userId: string }): Promise<string> }
      platform: Pick<AgentHostEnv, 'platformVercel' | 'agent37'>
      now?: (() => number) | undefined
    },
  ) {
    this.now = args.now ?? Date.now
  }

  async read({ sessionId }: { sessionId: string }): Promise<AgentHostConfig> {
    const { db } = this.args
    const session = await db.orm.v2.V2Session.first({ id: sessionId })
    if (session === null) throw new SessionNotFoundError(sessionId)
    const { userId, projectId } = session
    const provider = sandboxProviderOf(session.sandboxProvider)
    const [project, vercelRow, accounts, activeAccounts, settings, skills] = await Promise.all([
      this.projectOf(projectId),
      this.credentialRowOf({ userId, credentialSource: session.credentialSource }),
      db.orm.public.AgentAccount.where({ userId }).all(),
      db.orm.public.ActiveAccount.where({ userId }).all(),
      this.settingsOf({ userId, projectId }),
      skillIndexOf({ db, userId, projectId }),
    ])
    const models = this.modelSourceFor({ session, accounts, activeAccounts, settings })
    return {
      userId,
      projectId,
      model: models.main.config,
      models,
      workspace: workspaceOf(project),
      sandbox: await this.sandboxOf({
        userId,
        provider,
        credentialSource: session.credentialSource,
        row: vercelRow,
        vcpus: project?.sandboxVcpus ?? (await this.personalVcpusOf({ userId })),
      }),
      podSize: {
        desiredVcpus: session.podDesiredVcpus ?? undefined,
        generation: session.podSizeGeneration,
      },
      skills,
    }
  }

  private async credentialRowOf(args: {
    userId: string
    credentialSource: string
  }): Promise<VercelRow | null> {
    if (args.credentialSource === ECredentialSource.Platform) return null
    return await this.args.db.orm.public.UserVercelCredential.first({ userId: args.userId })
  }

  private async sandboxOf(args: {
    userId: string
    provider: ESandboxProvider
    credentialSource: string
    row: VercelRow | null
    vcpus: number | undefined
  }): Promise<SandboxConfig> {
    if (args.credentialSource === ECredentialSource.Platform) {
      const credentials = platformCredentialsOf({
        provider: args.provider,
        env: this.args.platform,
      })
      if ('configured' in credentials) {
        return { configured: false, provider: args.provider, gap: credentials.gap }
      }
      return {
        configured: true,
        provider: args.provider,
        credentials,
        ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
      }
    }
    if (args.provider !== ESandboxProvider.Vercel) {
      return { configured: false, provider: args.provider, gap: 'provider-credential-mismatch' }
    }
    const vercel = await this.vercelOf({ userId: args.userId, row: args.row })
    if (vercel.configured === false) {
      return { configured: false, provider: ESandboxProvider.Vercel, gap: vercel.gap }
    }
    return {
      configured: true,
      provider: ESandboxProvider.Vercel,
      credentials: {
        provider: ESandboxProvider.Vercel,
        token: vercel.token,
        teamId: vercel.teamId,
        projectId: vercel.projectId,
      },
      ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
    }
  }

  async models({ sessionId }: { sessionId: string }): Promise<ModelSource> {
    const { db } = this.args
    const session = await db.orm.v2.V2Session.first({ id: sessionId })
    if (session === null) throw new SessionNotFoundError(sessionId)
    const { userId, projectId } = session
    const [accounts, activeAccounts, settings] = await Promise.all([
      db.orm.public.AgentAccount.where({ userId }).all(),
      db.orm.public.ActiveAccount.where({ userId }).all(),
      this.settingsOf({ userId, projectId }),
    ])
    return this.modelSourceFor({ session, accounts, activeAccounts, settings })
  }

  private modelSourceFor(args: {
    session: ModelChoiceRow
    accounts: readonly AccountRow[]
    activeAccounts: readonly ActiveAccountRow[]
    settings: ReadonlyMap<string, string>
  }): ModelSource {
    const { session } = args
    return modelSourceOf({
      cipher: this.args.cipher,
      accounts: args.accounts,
      activeAccounts: args.activeAccounts,
      settings: args.settings,
      session: { ref: session.modelRef, effort: session.modelEffort, fast: session.modelFast },
    })
  }

  private async personalVcpusOf(args: { userId: string }): Promise<number | undefined> {
    const row = await this.args.db.orm.public.UserSetting.where({
      userId: args.userId,
      key: SANDBOX_VCPUS_KEY,
    })
      .select('value')
      .first()
    if (row === null) return undefined
    if (!validateCloudSetting({ key: SANDBOX_VCPUS_KEY, stored: row.value }).ok) return undefined
    const value = decodeSettingValue(row.value)
    return typeof value === 'number' ? value : undefined
  }

  private async projectOf(projectId: string | null): Promise<ProjectRow | null> {
    if (projectId === null) return null
    return await this.args.db.orm.public.Project.first({ id: projectId })
  }

  private async settingsOf(args: {
    userId: string
    projectId: string | null
  }): Promise<ReadonlyMap<string, string>> {
    const { db } = this.args
    const user = await db.orm.public.UserSetting.where({ userId: args.userId }).all()
    const settings = new Map(user.map((row) => [row.key, row.value]))
    if (args.projectId === null) return settings
    const project = await db.orm.public.ProjectSetting.where({ projectId: args.projectId }).all()
    for (const row of project) settings.set(row.key, row.value)
    return settings
  }

  private async vercelOf(args: { userId: string; row: VercelRow | null }): Promise<VercelConfig> {
    const { row } = args
    if (row === null || row.vercelProjectId === null) {
      return { configured: false, gap: 'user-credential' }
    }
    if (row.kind === 'oauth') {
      if (row.oauthNeedsReconnect) return { configured: false, gap: 'vercel-reconnect-required' }
      const expiresAt = row.accessTokenExpiresAt?.getTime() ?? 0
      if (expiresAt - OAUTH_EXPIRY_MARGIN_MS <= this.now()) {
        return this.refreshedVercel({ userId: args.userId, row })
      }
    }
    return this.vercelConfigured({ row, token: this.openToken(row.sealedToken) })
  }

  private async refreshedVercel(args: { userId: string; row: VercelRow }): Promise<VercelConfig> {
    try {
      const token = await this.args.vercel.refresh({ userId: args.userId })
      return this.vercelConfigured({ row: args.row, token })
    } catch (error) {
      if (error instanceof VercelReconnectRequiredError) {
        return { configured: false, gap: 'vercel-reconnect-required' }
      }
      return { configured: false, gap: 'vercel-oauth-refresh-required' }
    }
  }

  private openToken(sealed: string): unknown {
    return JSON.parse(this.args.cipher.decrypt(sealed))
  }

  private vercelConfigured(args: { row: VercelRow; token: unknown }): VercelConfig {
    const { row, token } = args
    if (row.vercelProjectId === null) return { configured: false, gap: 'user-credential' }
    if (typeof token !== 'string') return { configured: false, gap: 'user-credential' }
    return { configured: true, token, teamId: row.teamId, projectId: row.vercelProjectId }
  }
}
