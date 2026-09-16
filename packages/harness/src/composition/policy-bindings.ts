import {
  choiceValueOf,
  classifierModeOf,
  DEFAULT_CLASSIFIER_POLICY,
  DEFAULT_WORKTREE_DIRECTORY,
  EClassifierMode,
  ESettingId,
  EWebSearchBackend,
  backendOf,
  environmentFor,
  JudgePort,
  type CredentialPort,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import { HaikuJudge } from '../classifier/judge'
import {
  ClassifierPolicyToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
} from '../container/tokens'
import { portToken, type DependencyContainer } from '../container/injection'
import { createAnthropicOauthModel } from '../providers/anthropic-oauth'
import type { SettingsService } from '../settings/service'
import { remotesOf } from '../workspace/probe'

import { TITLER_MODEL_ID } from './config'

export async function bindSettingsPolicy(args: {
  container: DependencyContainer
  settings: SettingsService
  workspace: WorkspaceIdentity
  credentials: CredentialPort
  cwd: string
}): Promise<void> {
  const { container, settings, workspace } = args

  container.register(WorktreeDirectoryToken, {
    useValue: () =>
      choiceValueOf({
        resolution: settings.snapshot().resolution,
        id: ESettingId.WorktreeDirectory,
        fallback: DEFAULT_WORKTREE_DIRECTORY,
      }),
  })

  const environment = environmentFor({
    projectDirectory: workspace.workspace,
    repoRoot: workspace.repo ?? undefined,
    worktreeHome:
      workspace.repo === null
        ? undefined
        : `${workspace.repo}/${choiceValueOf({
            resolution: settings.snapshot().resolution,
            id: ESettingId.WorktreeDirectory,
            fallback: DEFAULT_WORKTREE_DIRECTORY,
          })}`,
    remotes: await remotesOf({ cwd: args.cwd }),
  })

  container.register(ClassifierPolicyToken, {
    useValue: () => ({
      ...DEFAULT_CLASSIFIER_POLICY,
      environment,
      mode:
        classifierModeOf(
          choiceValueOf({
            resolution: settings.snapshot().resolution,
            id: ESettingId.ClassifierMode,
            fallback: EClassifierMode.Shadow,
          }),
        ) ?? EClassifierMode.Shadow,
    }),
  })

  container.register(portToken(JudgePort), {
    useValue: new HaikuJudge({
      model: createAnthropicOauthModel({ credentials: args.credentials, modelId: TITLER_MODEL_ID }),
    }),
  })

  container.register(WebSearchBackendToken, {
    useValue: () =>
      backendOf(
        choiceValueOf({
          resolution: settings.snapshot().resolution,
          id: ESettingId.WebSearchBackend,
          fallback: EWebSearchBackend.DuckDuckGo,
        }),
      ) ?? EWebSearchBackend.DuckDuckGo,
  })
}
