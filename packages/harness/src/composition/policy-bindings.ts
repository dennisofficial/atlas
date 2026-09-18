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
  type CredentialPort,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import {
  ClassifierPolicyToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
} from '../container/tokens'
import type { DependencyContainer } from '../container/injection'
import type { SettingsService } from '../settings/service'
import { remotesOf } from '../workspace/probe'

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
