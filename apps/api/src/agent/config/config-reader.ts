import { z } from 'zod'
import type { Db } from '@dltech/atlas-db'
import { decodeSettingValue, validateCloudSetting } from '@dltech/atlas-core'
import {
  DEFAULT_SANDBOX_PROVIDER,
  ECredentialSource,
  ESandboxProvider,
} from '@dltech/atlas-protocol'

import type {
  AgentHostConfig,
  ConfigSource,
  SandboxConfig,
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
import { scopedSettingsOf } from './scoped-settings'
import { skillIndexOf } from './skill-index'
import { platformCredentialsOf } from './platform-credentials'
import { BYOK_RETIRED_GAP } from '../runtime/sandbox-not-configured-error'

type ModelChoiceRow = {
  modelRef: string
  modelEffort: string
  modelFast: boolean
  sandboxProvider: string
  credentialSource: string
}

const sandboxProviderOf = (pinned: string | null | undefined): ESandboxProvider => {
  const value = pinned?.trim() ?? ''
  if (value === '') return DEFAULT_SANDBOX_PROVIDER
  return z.nativeEnum(ESandboxProvider).parse(value)
}

const repoSchema = z.object({ repo: z.string().min(1), branch: z.string().min(1).optional() })

export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`session ${sessionId} not found`)
    this.name = 'SessionNotFoundError'
  }
}

type ProjectRow = {
  repo: string | null
  baseBranch: string | null
  additionalRepos: unknown
  setupScript: string
  sandboxVcpus: number | null
  sandboxDiskGb: number | null
}

const SANDBOX_VCPUS_KEY = 'sandbox.vcpus'
const SANDBOX_DISK_GB_KEY = 'sandbox.diskGb'

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
    const [project, accounts, activeAccounts, settings, skills] = await Promise.all([
      this.projectOf(projectId),
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
      sandbox: this.sandboxOf({
        provider,
        credentialSource: session.credentialSource,
        vcpus:
          project?.sandboxVcpus ??
          (await this.personalNumberSettingOf({ userId, key: SANDBOX_VCPUS_KEY })),
        diskGb:
          project?.sandboxDiskGb ??
          (await this.personalNumberSettingOf({ userId, key: SANDBOX_DISK_GB_KEY })),
      }),
      podSize: {
        desiredVcpus: session.podDesiredVcpus ?? undefined,
        generation: session.podSizeGeneration,
      },
      skills,
    }
  }

  private sandboxOf(args: {
    provider: ESandboxProvider
    credentialSource: string
    vcpus: number | undefined
    diskGb: number | undefined
  }): SandboxConfig {
    if (args.credentialSource !== ECredentialSource.Platform) {
      return { configured: false, provider: args.provider, gap: BYOK_RETIRED_GAP }
    }
    const credentials = platformCredentialsOf({ provider: args.provider, env: this.args.platform })
    if ('configured' in credentials) {
      return { configured: false, provider: args.provider, gap: credentials.gap }
    }
    return {
      configured: true,
      provider: args.provider,
      credentials,
      ...(args.vcpus === undefined ? {} : { vcpus: args.vcpus }),
      ...(args.diskGb === undefined ? {} : { diskGb: args.diskGb }),
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

  private async personalNumberSettingOf(args: {
    userId: string
    key: string
  }): Promise<number | undefined> {
    const row = await this.args.db.orm.public.UserSetting.where({
      userId: args.userId,
      key: args.key,
    })
      .select('value')
      .first()
    if (row === null) return undefined
    if (!validateCloudSetting({ key: args.key, stored: row.value }).ok) return undefined
    const value = decodeSettingValue(row.value)
    return typeof value === 'number' ? value : undefined
  }

  private async projectOf(projectId: string | null): Promise<ProjectRow | null> {
    if (projectId === null) return null
    return await this.args.db.orm.public.Project.first({ id: projectId })
  }

  private settingsOf(args: { userId: string; projectId: string | null }) {
    return scopedSettingsOf({ db: this.args.db, ...args })
  }
}
