import {
  choiceValueOf,
  classifierModeOf,
  DEFAULT_CLASSIFIER_POLICY,
  DEFAULT_WORKTREE_DIRECTORY,
  EClassifierMode,
  ESettingId,
  ESettingsLayer,
  EWebSearchBackend,
  backendOf,
  environmentFor,
  textValueOf,
  toggleValueOf,
  type CredentialPort,
  type SecretsPort,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import {
  ClassifierPolicyToken,
  GrillingCeremonyEnabledToken,
  SkillSuggestionEnabledToken,
  WebSearchBackendToken,
  WorktreeDirectoryToken,
} from '../container/tokens'
import type { DependencyContainer } from '../container/injection'
import { liveDecisionsEndpoint } from '../classifier/decision-backend'
import type { SettingsService } from '../settings/service'
import { remotesOf } from '../workspace/probe'

export async function bindSettingsPolicy(args: {
  container: DependencyContainer
  settings: SettingsService
  secrets: SecretsPort
  workspace: WorkspaceIdentity
  credentials: CredentialPort
  cwd: string
}): Promise<void> {
  const { container, settings, workspace } = args
  const decisionsEndpoint = liveDecisionsEndpoint({ settings, secrets: args.secrets })

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
    useValue: () => {
      const resolution = settings.snapshot().resolution
      const chosen =
        classifierModeOf(
          choiceValueOf({
            resolution,
            id: ESettingId.ClassifierMode,
            fallback: EClassifierMode.Shadow,
          }),
        ) ?? EClassifierMode.Shadow
      const defaulted =
        resolution.settings.get(ESettingId.ClassifierMode)?.layer === ESettingsLayer.Default
      const decisionsLive = decisionsEndpoint() !== null

      return {
        ...DEFAULT_CLASSIFIER_POLICY,
        environment,
        mode: defaulted && decisionsLive ? EClassifierMode.Nudge : chosen,
      }
    },
  })

  container.register(SkillSuggestionEnabledToken, {
    useValue: () => {
      const resolution = settings.snapshot().resolution
      return toggleValueOf({ resolution, id: ESettingId.SkillSuggest }) && decisionsEndpoint() !== null
    },
  })

  container.register(GrillingCeremonyEnabledToken, {
    useValue: () =>
      toggleValueOf({
        resolution: settings.snapshot().resolution,
        id: ESettingId.GrillingCeremony,
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
