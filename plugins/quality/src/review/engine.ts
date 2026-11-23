import {
  EQualityReviewStatus,
  EQualitySkipReason,
  QualityReviewPort,
  foldQualityFindings,
  type CapturedFileChange,
  type ClassifierPort,
  type EventDraft,
  type QualityCoverageDiagnostic,
  type QualityFinding,
  type QualityRegistry,
  type WorkspaceIdentityPort,
} from '@dltech/atlas-core'

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
import { buildRecord, renderNudge, validateItem, type ReviewItem } from './review-records'
import { normalizeWorkspacePath, type QualitySourceAdapter } from './review-scopes'
import { deadlineFailure, recordScope, reviewScopeJob, type ScopeJob } from './scope-review'
import { qualitySwitches } from './settings'
import { resolveWorkspaceNamespace } from './workspace-namespace'

export type CodeQualityReviewDeps = {
  classifier: ClassifierPort
  requestedModel: string
  source: QualitySourceAdapter
  registry: QualityRegistry
  settings: () => Readonly<Record<string, unknown>>
  workspaceIdentity: WorkspaceIdentityPort
  clock: () => number
  deadlineMs: number
}

const UNIDENTIFIED_NAMESPACE = 'unidentified'

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class CodeQualityReview extends QualityReviewPort {
  constructor(private readonly deps: CodeQualityReviewDeps) {
    super()
  }

  captureEnabled(): boolean {
    return qualitySwitches({ values: this.deps.settings() }).enabled
  }

  async review(args: ReviewArgs): Promise<readonly EventDraft[]> {
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

  private async reviewUnderSignal(args: ReviewArgs): Promise<readonly EventDraft[]> {
    const switches = qualitySwitches({ values: this.deps.settings() })
    if (!switches.enabled) return []
    if (args.changes.length === 0 && args.captureFaults.length === 0) return []

    const started = this.deps.clock()
    const namespace = await resolveWorkspaceNamespace({
      identity: this.deps.workspaceIdentity,
      projectDirectory: args.projectDirectory,
      threadId: args.call.threadId,
      signal: args.signal,
    })
    if (typeof namespace !== 'string') {
      return this.finish({ items: this.bail({ args, started, ...namespace }), signal: args.signal })
    }

    const records = args.events.flatMap((event) => qualityReviewsOf(event))
    const ctx: ReviewContext = {
      ...args,
      namespace,
      started,
      records,
      ledger: foldQualityFindings({ records }),
      policies: this.deps.registry.enabled({ settings: switches.policyFlags }),
    }

    const items = args.captureFaults.map((fault) => this.faultItem({ ctx, fault }))
    const jobs: ScopeJob[] = []
    for (const change of args.changes) {
      const reviewed = this.reviewChange({ ctx, change })
      items.push(...reviewed.items)
      jobs.push(...reviewed.jobs)
    }
    items.push(...(await Promise.all(jobs.map((job) => this.runJob({ ctx, job })))))
    return this.finish({ items, signal: args.signal })
  }

  private finish({
    items,
    signal,
  }: {
    items: readonly ReviewItem[]
    signal: AbortSignal
  }): readonly EventDraft[] {
    const lateNudge = deadlineErrorOf(signal) !== undefined
    const validated = items.map((item) => validateItem({ item }))
    const drafts: EventDraft[] = validated.map(({ record }) => record)
    const text = renderNudge({ items: validated })
    if (text !== undefined && !lateNudge) drafts.push({ type: 'nudge', text, lifetimeSteps: 1 })
    return drafts
  }

  private bail({
    args,
    started,
    status,
    reason,
    detail,
  }: {
    args: ReviewArgs
    started: number
    status: EQualityReviewStatus
    reason: EQualitySkipReason
    detail: string
  }): ReviewItem[] {
    const paths = [
      ...args.changes.map((change) => change.path),
      ...args.captureFaults.map((fault) => fault.path),
    ].map(
      (path) => normalizeWorkspacePath({ projectDirectory: args.projectDirectory, path }) ?? path,
    )
    const durationMs = this.deps.clock() - started
    return paths.map((path) => ({
      record: buildRecord({
        callId: args.call.callId,
        workspaceNamespace: UNIDENTIFIED_NAMESPACE,
        path,
        status,
        reason,
        detail,
        durationMs,
      }),
      notifiable: [],
    }))
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

  private async runJob({ ctx, job }: { ctx: ReviewContext; job: ScopeJob }): Promise<ReviewItem> {
    const previous: readonly QualityFinding[] = ctx.ledger.get(job.scope.id) ?? []
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
      return recordScope({
        callId: ctx.call.callId,
        job,
        results,
        previous,
        durationMs: this.deps.clock() - ctx.started,
        requestedModel: this.deps.requestedModel,
      }).item
    } catch (error) {
      return this.skip({
        ctx,
        path: job.path,
        scope: job.scope,
        reason: EQualitySkipReason.DecisionUnavailable,
        detail: describeError(error),
      })
    }
  }
}
