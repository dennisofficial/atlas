import {
  ESettingId,
  type ClassifierPort,
  type ClassifierStatus,
  type ProcessPort,
} from '@dltech/atlas-core'
import type { QualityStagePort } from '@dltech/atlas-agent'
import {
  DaemonWorkspaceIdentity,
  QUALITY_REVIEW_BUDGET_MS,
  qualityStageOf,
} from '@dltech/atlas-host'
import type { LogPort } from '@dltech/atlas-observability'
import { CodeQualityReview, prepareQualityScopes, qualityRegistry } from '@dltech/atlas-quality'

import type { QualityConfig } from '../config/quality-config'

export function qualityStageFor(args: {
  quality: QualityConfig
  classifier: ClassifierPort
  classifierStatus: ClassifierStatus
  processes: ProcessPort
  clock: () => number
  log?: LogPort | undefined
}): QualityStagePort | undefined {
  const { classifierStatus } = args
  if (!classifierStatus.on || !args.quality.enabled) return undefined
  return qualityStageOf({
    review: new CodeQualityReview({
      classifier: args.classifier,
      requestedModel: classifierStatus.model,
      source: { prepareQualityScopes },
      registry: qualityRegistry,
      settings: () => ({
        ...args.quality.policies,
        [ESettingId.QualityEnabled]: args.quality.enabled,
      }),
      workspaceIdentity: new DaemonWorkspaceIdentity({ process: args.processes }),
      clock: args.clock,
      deadlineMs: QUALITY_REVIEW_BUDGET_MS,
    }),
    clock: args.clock,
    logPort: args.log,
  })
}
