import {
  EQualityReviewStatus,
  EQualitySkipReason,
  type CapturedFileChange,
  type QualityPolicy,
  type QualityScope,
  type QualityScopePreparation,
} from '@dltech/atlas-core'

import { retirementItem } from './coverage-records'
import type { ChangeReview, CoverageBase, ReviewContext, SkipArgs } from './review-context'
import type { ReviewItem } from './review-records'
import {
  normalizeWorkspacePath,
  planRequests,
  previousScopesOf,
  selectPolicyScopes,
  type QualitySourceAdapter,
} from './review-scopes'
import type { ScopeJob } from './scope-review'

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export type ChangeReviewDeps = {
  source: QualitySourceAdapter
  skip: (args: SkipArgs) => ReviewItem
  base: (args: { ctx: ReviewContext }) => CoverageBase
}

function prepare({
  ctx,
  change,
  path,
  deps,
}: {
  ctx: ReviewContext
  change: CapturedFileChange
  path: string
  deps: ChangeReviewDeps
}): { item: ReviewItem } | QualityScopePreparation {
  try {
    return deps.source.prepareQualityScopes({
      change,
      projectDirectory: ctx.projectDirectory,
      workspaceNamespace: ctx.namespace,
      previousScopes: previousScopesOf({
        records: ctx.records,
        path,
        workspaceNamespace: ctx.namespace,
      }),
    })
  } catch (error) {
    return {
      item: deps.skip({
        ctx,
        path,
        reason: EQualitySkipReason.SourceUnavailable,
        detail: describeError(error),
      }),
    }
  }
}

function scopeJob({
  path,
  scope,
  policies,
}: {
  path: string
  scope: QualityScope
  policies: readonly QualityPolicy[]
}): ScopeJob {
  try {
    return { path, scope, plan: planRequests({ scope, policies }) }
  } catch (error) {
    return {
      path,
      scope,
      plan: {
        units: [],
        rejected: [
          {
            status: EQualityReviewStatus.OperationalError,
            reason: undefined,
            detail: describeError(error),
          },
        ],
      },
    }
  }
}

export function reviewChange({
  ctx,
  change,
  deps,
}: {
  ctx: ReviewContext
  change: CapturedFileChange
  deps: ChangeReviewDeps
}): ChangeReview {
  const path = normalizeWorkspacePath({
    projectDirectory: ctx.projectDirectory,
    path: change.path,
  })
  if (path === null) {
    return {
      items: [deps.skip({ ctx, path: change.path, reason: EQualitySkipReason.OutsideWorkspace })],
      jobs: [],
    }
  }

  const preparation = prepare({ ctx, change, path, deps })
  if ('item' in preparation) return { items: [preparation.item], jobs: [] }

  const items = preparation.skipped.map((fault) =>
    deps.skip({ ctx, path, reason: fault.reason, detail: fault.detail }),
  )
  const live = preparation.scopes.filter((scope) => scope.after !== null)
  const selected = selectPolicyScopes({ policies: ctx.policies, scopes: preparation.scopes })
  const selections = selected.selections.filter((selection) => selection.scope.after !== null)
  for (const fault of selected.faults) {
    items.push(
      deps.skip({
        ctx,
        path,
        scope: fault.scope,
        reason: EQualitySkipReason.ScopeIdentityUncertain,
        detail: fault.detail,
      }),
    )
  }

  for (const scope of preparation.scopes.filter((candidate) => !live.includes(candidate))) {
    items.push(
      retirementItem({
        ...deps.base({ ctx }),
        scope,
        path,
        previous: ctx.ledger.get(scope.id) ?? [],
      }),
    )
  }

  const jobs = selections.map(({ scope, policies }) => scopeJob({ path, scope, policies }))
  return { items, jobs }
}
