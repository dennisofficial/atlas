import type { PodsEnv } from '@dltech/atlas-pods/env'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { readSandboxConfig, SessionNotFoundError } from '@dltech/atlas-pods/config/sandbox-config'
import type { Db } from '@dltech/atlas-db'
import { z } from 'zod'

import type { AgentHostConfig, ConfigSource, WorkspaceConfig } from './agent-host-config'
import { classifierConfigOf } from './classifier-config'
import { rotationConfigOf } from './rotation-config'
import {
  modelSourceOf,
  type ActiveAccountRow,
  type AccountRow,
  type ModelSource,
} from './model-config'
import { scopedSettingsOf } from './scoped-settings'
import { skillIndexOf } from './skill-index'

export { SessionNotFoundError }

type ModelChoiceRow = {
  modelRef: string
  modelEffort: string
  modelFast: boolean
  sandboxProvider: string
  credentialSource: string
}

const repoSchema = z.object({ repo: z.string().min(1), branch: z.string().min(1).optional() })

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

export const sessionModelSourceOf = async (args: {
  db: Db
  cipher: SecretCipher
  sessionId: string
}): Promise<{ userId: string; models: ModelSource }> => {
  const session = await args.db.orm.public.Session.first({ id: args.sessionId })
  if (session === null) throw new SessionNotFoundError(args.sessionId)
  const { userId, projectId } = session
  const [accounts, activeAccounts, settings] = await Promise.all([
    args.db.orm.public.AgentAccount.where({ userId }).all(),
    args.db.orm.public.ActiveAccount.where({ userId }).all(),
    scopedSettingsOf({ db: args.db, userId, projectId }),
  ])
  const models = modelSourceOf({
    cipher: args.cipher,
    accounts,
    activeAccounts,
    settings,
    session: { ref: session.modelRef, effort: session.modelEffort, fast: session.modelFast },
  })
  return { userId, models }
}

export class ConfigReader implements ConfigSource {
  private readonly now: () => number

  constructor(
    private readonly args: {
      db: Db
      cipher: SecretCipher
      platform: Pick<PodsEnv, 'platformVercel' | 'agent37'>
      now?: (() => number) | undefined
    },
  ) {
    this.now = args.now ?? Date.now
  }

  async read({ sessionId }: { sessionId: string }): Promise<AgentHostConfig> {
    const { db } = this.args
    const session = await db.orm.public.Session.first({ id: sessionId })
    if (session === null) throw new SessionNotFoundError(sessionId)
    const { userId, projectId } = session
    const project = await this.projectOf(projectId)
    const [accounts, activeAccounts, settings, skills, sandbox] = await Promise.all([
      db.orm.public.AgentAccount.where({ userId }).all(),
      db.orm.public.ActiveAccount.where({ userId }).all(),
      this.settingsOf({ userId, projectId }),
      skillIndexOf({ db, userId, projectId, groupId: project?.groupId ?? null }),
      readSandboxConfig({ db, platform: this.args.platform, sessionId }),
    ])
    const models = this.modelSourceFor({ session, accounts, activeAccounts, settings })
    return {
      userId,
      projectId,
      model: models.main.config,
      models,
      classifier: classifierConfigOf({
        cipher: this.args.cipher,
        accounts,
        activeAccounts,
        settings,
      }),
      rotation: rotationConfigOf({ settings }),
      workspace: workspaceOf(project),
      sandbox,
      podSize: {
        desiredVcpus: session.podDesiredVcpus ?? undefined,
        desiredMemoryGb: session.podDesiredMemoryGb ?? undefined,
        generation: session.podSizeGeneration,
      },
      skills,
    }
  }

  async models({ sessionId }: { sessionId: string }): Promise<ModelSource> {
    const read = await sessionModelSourceOf({
      db: this.args.db,
      cipher: this.args.cipher,
      sessionId,
    })
    return read.models
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

  private async projectOf(projectId: string | null): Promise<ProjectRow | null> {
    if (projectId === null) return null
    return await this.args.db.orm.public.Project.first({ id: projectId })
  }

  private settingsOf(args: { userId: string; projectId: string | null }) {
    return scopedSettingsOf({ db: this.args.db, ...args })
  }
}
