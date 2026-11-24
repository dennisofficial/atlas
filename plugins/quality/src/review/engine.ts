import {
  EQualitySkipReason,
  type EQualityLanguage,
  type CapturedFileChange,
  type ClassifierPort,
  type CodeQualityReviewedBody,
  type QualityCoverageDiagnostic,
  type QualityFinding,
} from '@dltech/atlas-core'

import { foldQualityFindings } from './ledger'
import type { QualityRegistry } from './registry'

import { reviewChange } from './change-review'
import { skipItem } from './coverage-records'
import { createQualityBudget, deadlineErrorOf } from './deadline'
import { qualityReviewsOf } from './quality-reviews'
import type {
  ChangeReview,
  CoverageBase,
  ReviewArgs,
  ReviewContext,
  SkipArgs,
} from './review-context'
import {
  renderNotes,
  validateItem,
  type NotifiableEntry,
  type QualityNote,
  type ReviewItem,
} from './review-records'
import { normalizeWorkspacePath, type QualitySourceAdapter } from './review-scopes'
import { deadlineFailure, recordScope, reviewScopeJob, type ScopeJob } from './scope-review'
import { qualitySwitches } from './settings'

export type CodeQualityReviewDeps = {
  classifier: ClassifierPort
  requestedModel: string
  source: QualitySourceAdapter
  registry: QualityRegistry
  settings: () => Readonly<Record<string, unknown>>
  clock: () => number
  deadlineMs: number
}

export type QualityReviewTimings = {
  scopeBuildMs: number
  classifierMs: number
  totalMs: number
}

export type QualityReviewMetrics = {
  timings: QualityReviewTimings
  language: EQualityLanguage | null
  inputTokens: number | null
}

export type FlaggedExample = {
  record: CodeQualityReviewedBody
  entry: NotifiableEntry
}

export type QualityReviewResult = QualityReviewMetrics & {
  records: readonly CodeQualityReviewedBody[]
  flagged: readonly FlaggedExample[]
  notes: readonly QualityNote[]
}

export const NO_REVIEW_METRICS: QualityReviewMetrics = {
  timings: { scopeBuildMs: 0, classifierMs: 0, totalMs: 0 },
  language: null,
  inputTokens: null,
}

export const NO_REVIEW_RESULT: QualityReviewResult = {
  ...NO_REVIEW_METRICS,
  records: [],
  flagged: [],
  notes: [],
}

type ScopeRun = { item: ReviewItem; classifierMs: number; inputTokens: number | null }

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const sumTokens = ({ tokens }: { tokens: readonly (number | null)[] }): number | null => {
  const known = tokens.filter((token): token is number => token !== null)
  return known.length === 0 ? null : known.reduce((sum, token) => sum + token, 0)
}

export class CodeQualityReview {
  constructor(private readonly deps: CodeQualityReviewDeps) {}

  async review(args: ReviewArgs): Promise<QualityReviewResult> {
    if (args.deadlineAt !== undefined) return this.reviewUnderSignal(args)
    const budget = createQualityBudget({
      signal: args.signal,
      budgetMs: this.deps.deadlineMs,
      now: this.deps.clock,
    })
    try {
      return await this.reviewUnderSignal({ ...args, signal: budget.signal })
    } finally {
      budget.dispose()
    }
  }

  private async reviewUnderSignal(args: ReviewArgs): Promise<QualityReviewResult> {
    const switches = qualitySwitches({ values: this.deps.settings() })
    if (!switches.enabled) return NO_REVIEW_RESULT
    if (args.changes.length === 0 && args.captureFaults.length === 0) return NO_REVIEW_RESULT

    const started = this.deps.clock()
    const records = args.events.flatMap((event) => qualityReviewsOf(event))
    const ctx: ReviewContext = {
      ...args,
      namespace: args.projectDirectory,
      started,
      records,
      ledger: foldQualityFindings({ records }),
      policies: this.deps.registry.enabled({ settings: switches.policyFlags }),
    }

    const items = args.captureFaults.map((fault) => this.faultItem({ ctx, fault }))
    const jobs: ScopeJob[] = []
    const scopeStarted = this.deps.clock()
    for (const change of args.changes) {
      const reviewed = this.reviewChange({ ctx, change })
      items.push(...reviewed.items)
      jobs.push(...reviewed.jobs)
    }
    const scopeBuildMs = this.deps.clock() - scopeStarted

    const classifiers = await Promise.all(jobs.map((job) => this.runJob({ ctx, job })))
    for (const classifier of classifiers) items.push(classifier.item)
    const metrics: QualityReviewMetrics = {
      timings: {
        scopeBuildMs,
        classifierMs: classifiers.reduce((max, { classifierMs }) => Math.max(max, classifierMs), 0),
        totalMs: this.deps.clock() - started,
      },
      language: jobs[0]?.scope.language ?? null,
      inputTokens: sumTokens({ tokens: classifiers.map(({ inputTokens }) => inputTokens) }),
    }
    return this.finish({ items, signal: args.signal, metrics })
  }

  private finish({
    items,
    signal,
    metrics,
  }: {
    items: readonly ReviewItem[]
    signal: AbortSignal
    metrics: QualityReviewMetrics
  }): QualityReviewResult {
    const validated = items.map((item) => validateItem({ item }))
    return {
      ...metrics,
      records: validated.map(({ record }) => record),
      flagged: validated.flatMap(({ record, notifiable }) =>
        notifiable.map((entry): FlaggedExample => ({ record, entry })),
      ),
      notes: deadlineErrorOf(signal) === undefined ? renderNotes({ items: validated }) : [],
    }
  }

  private base({ ctx }: { ctx: ReviewContext }): CoverageBase {
    return {
      callId: ctx.call.callId,
      workspaceNamespace: ctx.namespace,
      durationMs: this.deps.clock() - ctx.started,
    }
  }

  private skip({ ctx, path, reason, detail, scope }: SkipArgs): ReviewItem {
    const previous = scope === undefined ? [] : (ctx.ledger.get(scope.id) ?? [])
    return skipItem({ ...this.base({ ctx }), path, reason, detail, scope, previous })
  }

  private faultItem({
    ctx,
    fault,
  }: {
    ctx: ReviewContext
    fault: QualityCoverageDiagnostic
  }): ReviewItem {
    const path =
      normalizeWorkspacePath({ projectDirectory: ctx.projectDirectory, path: fault.path }) ??
      fault.path
    return this.skip({ ctx, path, reason: fault.reason, detail: fault.detail })
  }

  private reviewChange({
    ctx,
    change,
  }: {
    ctx: ReviewContext
    change: CapturedFileChange
  }): ChangeReview {
    return reviewChange({
      ctx,
      change,
      deps: {
        source: this.deps.source,
        skip: (skipArgs) => this.skip(skipArgs),
        base: (baseArgs) => this.base(baseArgs),
      },
    })
  }

  private async runJob({ ctx, job }: { ctx: ReviewContext; job: ScopeJob }): Promise<ScopeRun> {
    const previous: readonly QualityFinding[] = ctx.ledger.get(job.scope.id) ?? []
    const classifierStarted = this.deps.clock()
    try {
      const reviewed = await reviewScopeJob({
        classifier: this.deps.classifier,
        requestedModel: this.deps.requestedModel,
        job,
        signal: ctx.signal,
      })
      const deadline = deadlineErrorOf(ctx.signal)
      const timedOut = reviewed.some(
        (result) => result.kind === 'failed' && result.reason === EQualitySkipReason.ReviewDeadline,
      )
      const results =
        deadline !== undefined && timedOut ? [deadlineFailure({ error: deadline })] : reviewed
      return {
        item: recordScope({
          callId: ctx.call.callId,
          job,
          results,
          previous,
          durationMs: this.deps.clock() - ctx.started,
          requestedModel: this.deps.requestedModel,
        }).item,
        classifierMs: this.deps.clock() - classifierStarted,
        inputTokens: sumTokens({ tokens: results.flatMap((result) => result.inputTokens) }),
      }
    } catch (error) {
      return {
        item: this.skip({
          ctx,
          path: job.path,
          scope: job.scope,
          reason: EQualitySkipReason.DecisionUnavailable,
          detail: describeError(error),
        }),
        classifierMs: this.deps.clock() - classifierStarted,
        inputTokens: null,
      }
    }
  }
}
