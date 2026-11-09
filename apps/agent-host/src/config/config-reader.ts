import { z } from 'zod'
import type { ThreadId } from '@dltech/atlas-core'
import type { Db } from '@dltech/atlas-db'

import type {
  AgentHostConfig,
  ConfigSource,
  VercelConfig,
  WorkspaceConfig,
} from './agent-host-config'
import { MODEL_SETTING_KEYS, modelConfigOf, type ThreadModelChoice } from './model-config'
import type { SecretCipher } from './secret-cipher'
import { skillIndexOf } from './skill-index'
import { VercelReconnectRequiredError } from '../tokens/vercel-token-refresher'

const OAUTH_EXPIRY_MARGIN_MS = 60_000

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
}

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
      now?: (() => number) | undefined
    },
  ) {
    this.now = args.now ?? Date.now
  }

  async read({
    sessionId,
    threadId,
  }: {
    sessionId: string
    threadId?: ThreadId | undefined
  }): Promise<AgentHostConfig> {
    const { db } = this.args
    const session = await db.orm.v2.V2Session.first({ id: sessionId })
    if (session === null) throw new SessionNotFoundError(sessionId)
    const { userId, projectId } = session
    const [project, vercel, accounts, activeAccounts, settings, skills, thread] = await Promise.all(
      [
        db.orm.public.Project.first({ id: projectId }),
        db.orm.public.UserVercelCredential.first({ userId }),
        db.orm.public.AgentAccount.where({ userId }).all(),
        db.orm.public.ActiveAccount.where({ userId }).all(),
        this.modelSettings({ userId, projectId }),
        skillIndexOf({ db, userId, projectId }),
        threadId === undefined
          ? Promise.resolve(null)
          : db.orm.public.Thread.first({ id: threadId }),
      ],
    )
    const named = this.modelChoiceOf(thread) ?? this.modelChoiceOf(session)
    return {
      userId,
      projectId,
      model: modelConfigOf({
        cipher: this.args.cipher,
        accounts,
        activeAccounts,
        settings,
        ...(named === undefined ? {} : { thread: named }),
      }),
      workspace: workspaceOf(project),
      vercel: await this.vercelOf({ userId, row: vercel }),
      skills,
    }
  }

  private modelChoiceOf(
    row: {
      modelRef: string | null
      modelEffort: string | null
      modelFast: boolean | null
    } | null,
  ): ThreadModelChoice | undefined {
    if (row === null || row.modelRef === null) return undefined
    return {
      ref: row.modelRef,
      ...(row.modelEffort === null ? {} : { effort: row.modelEffort }),
      ...(row.modelFast === null ? {} : { fast: row.modelFast }),
    }
  }

  private async modelSettings(args: {
    userId: string
    projectId: string
  }): Promise<ReadonlyMap<string, string>> {
    const { db } = this.args
    const keys = Object.values(MODEL_SETTING_KEYS)
    const [user, project] = await Promise.all([
      Promise.all(keys.map((key) => db.orm.public.UserSetting.first({ userId: args.userId, key }))),
      Promise.all(
        keys.map((key) => db.orm.public.ProjectSetting.first({ projectId: args.projectId, key })),
      ),
    ])
    const settings = new Map<string, string>()
    keys.forEach((key, index) => {
      const value = project[index]?.value ?? user[index]?.value
      if (value !== undefined) settings.set(key, value)
    })
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
