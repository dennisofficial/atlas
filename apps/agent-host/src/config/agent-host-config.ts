import type { EEffort, ModelRef } from '@dltech/atlas-core'

export type ModelCredential =
  | { kind: 'oauth'; connectionId: string }
  | { kind: 'api-key'; apiKey: string }

export type ModelConfig =
  | {
      configured: true
      ref: ModelRef
      effort: EEffort
      fast: boolean
      accountId: string
      credential: ModelCredential
    }
  | { configured: false; gap: string }

export type WorkspaceRepo = { repo: string; branch?: string | undefined }

export type WorkspaceConfig = {
  remoteUrl: string | null
  baseBranch: string | null
  additionalRepos: WorkspaceRepo[]
  setupScript: string
}

export type VercelConfig =
  | { configured: true; token: string; teamId: string; projectId: string }
  | { configured: false; gap: string }

export type SkillScope = 'user' | 'project'

export type SkillIndexEntry = { name: string; description: string; scope: SkillScope }

export type AgentHostConfig = {
  userId: string
  projectId: string
  model: ModelConfig
  workspace: WorkspaceConfig
  vercel: VercelConfig
  skills: SkillIndexEntry[]
}

export type ConfigSource = { read(args: { sessionId: string }): Promise<AgentHostConfig> }
