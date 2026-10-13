import {
  DecisionPort,
  ProcessPort,
  QualityReviewPort,
  WorkspaceIdentityPort,
  createQualityRegistry,
  singleResponsibilityPolicy,
} from '@dltech/atlas-core'

import { instanceCachingFactory, registeredPortToken, type DependencyContainer } from '../container/injection'
import { SessionRegistryToken } from '../container/tokens'
import { CodeQualityReview } from '../quality/engine'
import { QualityExampleSink } from '../quality/example-sink'
import { GitWorkspaceIdentity } from '../quality/git-workspace-identity'
import { qualitySettingDefinitions } from '../quality/settings'
import { prepareQualityScopes } from '../quality/source'
import type { SettingsService } from '../settings/service'
import { QUALITY_REVIEW_BUDGET_MS } from '../tools/quality-dispatch'

export function bindQuality(args: {
  container: DependencyContainer
  settings: SettingsService
}): void {
  const { container, settings } = args
  const registry = createQualityRegistry({ policies: [singleResponsibilityPolicy] })
  settings.register(qualitySettingDefinitions({ policies: registry.descriptors() }))

  container.register(registeredPortToken(WorkspaceIdentityPort), {
    useFactory: instanceCachingFactory((resolver) => new GitWorkspaceIdentity({
      process: resolver.resolve(registeredPortToken(ProcessPort)),
    })),
  })
  container.register(registeredPortToken(QualityReviewPort), {
    useFactory: instanceCachingFactory((resolver) => new CodeQualityReview({
      decisions: resolver.resolve(registeredPortToken(DecisionPort)),
      source: { prepareQualityScopes },
      registry,
      settings: () => Object.fromEntries(
        [...settings.snapshot().resolution.settings].map(([id, held]) => [id, held.value]),
      ),
      workspaceIdentity: resolver.resolve(registeredPortToken(WorkspaceIdentityPort)),
      examples: new QualityExampleSink({ sessions: resolver.resolve(SessionRegistryToken) }),
      clock: () => Date.now(),
      deadlineMs: QUALITY_REVIEW_BUDGET_MS,
    })),
  })
}
