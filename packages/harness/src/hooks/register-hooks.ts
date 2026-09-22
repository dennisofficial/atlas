import {
  AfterToolHook,
  AgentFileSystemPort,
  BeforeToolHook,
  BeforeTurnHook,
  DecisionPort,
  EventLogPort,
  ToolDefinition,
  WorkspaceFactsPort,
} from '@dltech/atlas-core'

import { registerClassifier } from '../classifier/register-classifier'
import { JevDecisionClient } from '../classifier/jev-client'
import { GitWorkspaceFacts } from '../classifier/workspace-facts'
import {
  instanceCachingFactory,
  portToken,
  resolveIfPossible,
  type DependencyContainer,
} from '../container/injection'
import { SkillSuggestionEnabledToken, WorkspaceRoot } from '../container/tokens'
import { FileReadStatePort } from '../files/read-state'
import { SkillRegistryPort } from '../skills/port'
import { InvalidateFactsHook } from './invalidate-facts'
import { MirrorPlanHook } from './mirror-plan'
import { OutsideProjectHook } from './outside-project'
import { PrewarmFactsHook } from './prewarm-facts'
import { ReadBeforeWriteHook } from './read-before-write'
import { ResolveProjectPathsHook } from './resolve-project-paths'
import { ServiceShapeHook } from './service-shape-hook'
import { RecordFileStateHook } from './record-file-state'
import { SkillSuggestionHook } from './skill-suggestion'
import { TrackWorktreeHook } from './track-worktree'

export function registerBuiltinHooks({ container }: { container: DependencyContainer }): void {
  container.register(portToken(WorkspaceFactsPort), {
    useFactory: instanceCachingFactory(() => new GitWorkspaceFacts()),
  })

  container.register(portToken(BeforeToolHook), {
    useFactory: (resolver) =>
      new ResolveProjectPathsHook(resolver.resolveAll(portToken(ToolDefinition))),
  })
  container.register(portToken(BeforeToolHook), {
    useFactory: (resolver) =>
      new ReadBeforeWriteHook(
        resolver.resolve(portToken(FileReadStatePort)),
        resolver.resolveAll(portToken(ToolDefinition)),
        resolver.resolve(portToken(AgentFileSystemPort)),
      ),
  })
  registerClassifier({ container })
  container.register(portToken(BeforeToolHook), {
    useFactory: (resolver) =>
      new ServiceShapeHook({
        decisions: resolver.isRegistered(portToken(DecisionPort), true)
          ? resolver.resolve(portToken(DecisionPort))
          : new JevDecisionClient({ config: () => undefined }),
      }),
  })
  container.register(portToken(BeforeTurnHook), {
    useFactory: (resolver) =>
      new PrewarmFactsHook(
        resolver.resolve(portToken(WorkspaceFactsPort)),
        resolver.resolve(WorkspaceRoot),
      ),
  })
  container.register(portToken(BeforeTurnHook), {
    useFactory: (resolver) =>
      new SkillSuggestionHook({
        log: resolveIfPossible({ container: resolver, token: portToken(EventLogPort) }),
        skills: resolveIfPossible({ container: resolver, token: portToken(SkillRegistryPort) }),
        decisions: resolver.isRegistered(portToken(DecisionPort), true)
          ? resolver.resolve(portToken(DecisionPort))
          : new JevDecisionClient({ config: () => undefined }),
        enabled: resolver.isRegistered(SkillSuggestionEnabledToken, true)
          ? resolver.resolve(SkillSuggestionEnabledToken)
          : () => false,
      }),
  })
  container.register(portToken(AfterToolHook), {
    useFactory: (resolver) =>
      new RecordFileStateHook(
        resolver.resolve(portToken(FileReadStatePort)),
        resolver.resolveAll(portToken(ToolDefinition)),
        resolver.resolve(portToken(AgentFileSystemPort)),
      ),
  })
  container.register(portToken(AfterToolHook), { useClass: MirrorPlanHook })
  container.register(portToken(AfterToolHook), { useClass: OutsideProjectHook })
  container.register(portToken(AfterToolHook), { useClass: TrackWorktreeHook })
  container.register(portToken(AfterToolHook), {
    useFactory: (resolver) =>
      new InvalidateFactsHook(resolver.resolve(portToken(WorkspaceFactsPort))),
  })
}
