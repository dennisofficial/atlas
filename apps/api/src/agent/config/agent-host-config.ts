import type { EEffort, ModelRef } from '@dltech/atlas-core'
import type { SandboxConfig } from '@dltech/atlas-pods/config/sandbox-config'

import type { ModelSource } from './model-config'

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
  | { configured: false; gap: string; unavailable?: ModelRef | undefined }

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

export type { SandboxConfig } from '@dltech/atlas-pods/config/sandbox-config'

export type SkillIndexEntry = { name: string; description: string; scope: SkillScope }

export type AgentHostConfig = {
  userId: string
  projectId: string | null
  model: ModelConfig
  models: ModelSource
  workspace: WorkspaceConfig
  sandbox: SandboxConfig
  podSize?: { desiredVcpus: number | undefined; generation: number } | undefined
  skills: SkillIndexEntry[]
}

export type ConfigSource = {
  read(args: { sessionId: string }): Promise<AgentHostConfig>
  models(args: { sessionId: string }): Promise<ModelSource>
}
