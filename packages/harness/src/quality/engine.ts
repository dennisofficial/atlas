import {
  EQualityReviewStatus,
  EQualitySkipReason,
  QualityReviewPort,
  foldQualityFindings,
  type CallId,
  type CapturedFileChange,
  type CodeQualityReviewedBody,
  type DecisionPort,
  type EventDraft,
  type QualityCoverageDiagnostic,
  type QualityFinding,
  type QualityPolicy,
  type QualityRegistry,
  type QualityScope,
  type RunId,
  type ToolCall,
  type WorkspaceIdentityPort,
  type Event,
} from '@dltech/atlas-core'

import { recordingFaultItem, retirementItem, skipItem } from './coverage-records'
import { createQualityAssessmentCache, type QualityAssessmentCache } from './evaluation-cache'
import { recordSelectedExamples, type ExampleOutcome } from './example-recording'
import type { QualityExampleSink } from './example-sink'
import { isQualityReviewEvent } from './health'
import { buildRecord, renderNudge, validateItem, type ReviewItem } from './review-records'
import {
  normalizeWorkspacePath,
  planRequests,
  previousScopesOf,
  selectPolicyScopes,
  type QualitySourceAdapter,
  type ScopeSelection,
} from './review-scopes'
import { recordScope, reviewScopeJob, type ScopeJob } from './scope-review'
import { resolveWorkspaceNamespace } from './workspace-namespace'
import { qualitySwitches, type QualitySettingsAccessor, type QualitySwitches } from './settings'

export type CodeQualityReviewDeps = {
  decisions: DecisionPort
  source: QualitySourceAdapter
  registry: QualityRegistry
  settings: QualitySettingsAccessor
  workspaceIdentity: WorkspaceIdentityPort
  examples?: Pick<QualityExampleSink, 'record'> | undefined
  clock: () => number
  deadlineMs: number
}

type ReviewArgs = {
  call: ToolCall
  runId: RunId
  changes: readonly CapturedFileChange[]
  captureFaults: readonly QualityCoverageDiagnostic[]
  events: readonly Event[]
  projectDirectory: string
  signal: AbortSignal
}

type ReviewContext = ReviewArgs & {
  namespace: string
  switches: QualitySwitches
  started: number
  records: readonly CodeQualityReviewedBody[]
  ledger: ReadonlyMap<string, readonly QualityFinding[]>
  policies: readonly QualityPolicy[]
}

type ChangeReview = { items: ReviewItem[]; jobs: ScopeJob[] }

const UNIDENTIFIED_NAMESPACE = 'unidentified'

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class CodeQualityReview extends QualityReviewPort {
  private readonly cache: QualityAssessmentCache = createQualityAssessmentCache()

  constructor(private readonly deps: CodeQualityReviewDeps) {
    super()
  }

  captureEnabled(): boolean {
    const { enabled, recordExamples } = qualitySwitches({ values: this.deps.settings() })
    return enabled || recordExamples
  }

  async review(args: ReviewArgs): Promise<readonly EventDraft[]> {
    const switches = qualitySwitches({ values: this.deps.settings() })
    if (!switches.enabled && !switches.recordExamples) return []
    if (args.changes.length === 0 && args.captureFaults.length === 0) return []

    const started = this.deps.clock()
    const namespace = await resolveWorkspaceNamespace({
      identity: this.deps.workspaceIdentity,
      projectDirectory: args.projectDirectory,
      threadId: args.call.threadId,
      signal: args.signal,
      deadlineMs: Math.max(1, this.deps.deadlineMs - (this.deps.clock() - started)),
    })
    if (typeof namespace !== 'string') {
      return this.finish({ items: this.bail({ args, started, ...namespace }) })
    }

    const records = args.events.filter(isQualityReviewEvent)
    const ctx: ReviewContext = {
      ...args,
      namespace,
      switches,
      started,
      records,
      ledger: foldQualityFindings({ records }),
      policies: this.deps.registry.enabled({ settings: switches.policyFlags }),
    }

    const items = args.captureFaults.map((fault) => this.faultItem({ ctx, fault }))
    const jobs: ScopeJob[] = []
    for (const change of args.changes) {
      const reviewed = await this.reviewChange({ ctx, change })
      items.push(...reviewed.items)
      jobs.push(...reviewed.jobs)
    }
    items.push(...(await Promise.all(jobs.map((job) => this.runJob({ ctx, job })))))
    return this.finish({ items })
  }

  private finish({ items }: { items: readonly ReviewItem[] }): readonly EventDraft[] {
    const validated = items.map((item) => validateItem({ item }))
    const drafts: EventDraft[] = validated.map(({ record }) => record)
    const text = renderNudge({ items: validated })
    if (text !== undefined) drafts.push({ type: 'nudge', text, lifetimeSteps: 1 })
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
    const paths = [...args.changes.map((change) => change.path), ...args.captureFaults.map((fault) => fault.path)].map(
      (path) => normalizeWorkspacePath({ projectDirectory: args.projectDirectory, path }) ?? path,
    )
    const durationMs = this.deps.clock() - started
    return paths.map((path) => ({
      record: buildRecord({ callId: args.call.callId, workspaceNamespace: UNIDENTIFIED_NAMESPACE, path, status, reason, detail, durationMs }),
      notifiable: [],
    }))
  }

  private base({ ctx }: { ctx: ReviewContext }): { callId: CallId; workspaceNamespace: string; durationMs: number } {
    return { callId: ctx.call.callId, workspaceNamespace: ctx.namespace, durationMs: this.deps.clock() - ctx.started }
  }

  private skip({
    ctx,
    path,
    reason,
    detail,
    scope,
    evidencePath,
  }: {
    ctx: ReviewContext
    path: string
    reason: EQualitySkipReason
    detail?: string | undefined
    scope?: QualityScope | undefined
    evidencePath?: string | undefined
  }): ReviewItem {
    const previous = scope === undefined ? [] : (ctx.ledger.get(scope.id) ?? [])
    return skipItem({ ...this.base({ ctx }), path, reason, detail, scope, previous, evidencePath })
  }

  private faultItem({ ctx, fault }: { ctx: ReviewContext; fault: QualityCoverageDiagnostic }): ReviewItem {
    const path = normalizeWorkspacePath({ projectDirectory: ctx.projectDirectory, path: fault.path }) ?? fault.path
    return this.skip({ ctx, path, reason: fault.reason, detail: fault.detail })
  }

  private async reviewChange({ ctx, change }: { ctx: ReviewContext; change: CapturedFileChange }): Promise<ChangeReview> {
    const path = normalizeWorkspacePath({ projectDirectory: ctx.projectDirectory, path: change.path })
    if (path === null) {
      return { items: [this.skip({ ctx, path: change.path, reason: EQualitySkipReason.OutsideWorkspace })], jobs: [] }
    }

    const preparation = this.prepare({ ctx, change, path })
    if ('item' in preparation) return { items: [preparation.item], jobs: [] }

    const items = preparation.skipped.map((fault) => this.skip({ ctx, path, reason: fault.reason, detail: fault.detail }))
    const live = preparation.scopes.filter((scope) => scope.after !== null)
    const selected = selectPolicyScopes({ policies: ctx.policies, scopes: preparation.scopes })
    const selections = selected.selections.filter((selection) => selection.scope.after !== null)
    for (const fault of selected.faults) {
      items.push(this.skip({ ctx, path, scope: fault.scope, reason: EQualitySkipReason.ScopeIdentityUncertain, detail: fault.detail }))
    }

    for (const scope of preparation.scopes.filter((candidate) => !live.includes(candidate))) {
      items.push(retirementItem({ ...this.base({ ctx }), scope, path, previous: ctx.ledger.get(scope.id) ?? [] }))
    }

    if (!ctx.switches.enabled) {
      const evidence = await this.recordExamples({ ctx, change, path, selections })
      for (const { scope } of selections) {
        const recorded = evidence.get(scope.id)
        items.push(this.skip({ ctx, path, scope, reason: EQualitySkipReason.Disabled, detail: recorded?.fault, evidencePath: recorded?.path }))
      }
      return { items, jobs: [] }
    }

    const evidence = await this.recordExamples({ ctx, change, path, selections })
    for (const outcome of evidence.values()) {
      if (outcome.fault !== undefined) items.push(recordingFaultItem({ ...this.base({ ctx }), path, fault: outcome.fault }))
    }
    const jobs = selections.map(({ scope, policies }): ScopeJob => {
      try {
        return { path, scope, plan: planRequests({ scope, policies }), evidencePath: evidence.get(scope.id)?.path }
      } catch (error) {
        return { path, scope, plan: { units: [], rejected: [{ status: EQualityReviewStatus.OperationalError, reason: undefined, detail: describeError(error) }] }, evidencePath: evidence.get(scope.id)?.path }
      }
    })
    return { items, jobs }
  }

  private prepare({ ctx, change, path }: { ctx: ReviewContext; change: CapturedFileChange; path: string }) {
    try {
      return this.deps.source.prepareQualityScopes({
        change,
        projectDirectory: ctx.projectDirectory,
        workspaceNamespace: ctx.namespace,
        previousScopes: previousScopesOf({ records: ctx.records, path, workspaceNamespace: ctx.namespace }),
      })
    } catch (error) {
      return { item: this.skip({ ctx, path, reason: EQualitySkipReason.SourceUnavailable, detail: describeError(error) }) }
    }
  }

  private async recordExamples({
    ctx,
    change,
    path,
    selections,
  }: {
    ctx: ReviewContext
    change: CapturedFileChange
    path: string
    selections: readonly ScopeSelection[]
  }): Promise<Map<string, ExampleOutcome>> {
    const sink = this.deps.examples
    if (sink === undefined || !ctx.switches.recordExamples) return new Map()
    return recordSelectedExamples({
      sink,
      selections,
      change: { ...change, path },
      provenance: { threadId: ctx.call.threadId, runId: ctx.runId, callId: ctx.call.callId, toolName: ctx.call.name },
      workspaceNamespace: ctx.namespace,
      signal: ctx.signal,
      deadlineMs: Math.max(1, this.deps.deadlineMs - (this.deps.clock() - ctx.started)),
    })
  }

  private async runJob({ ctx, job }: { ctx: ReviewContext; job: ScopeJob }): Promise<ReviewItem> {
    const previous = ctx.ledger.get(job.scope.id) ?? []
    try {
      const results = await reviewScopeJob({
        decisions: this.deps.decisions,
        cache: this.cache,
        job,
        signal: ctx.signal,
        deadlineMs: () => Math.max(0, this.deps.deadlineMs - (this.deps.clock() - ctx.started)),
      })
      return recordScope({ callId: ctx.call.callId, job, results, previous, durationMs: this.deps.clock() - ctx.started }).item
    } catch (error) {
      return this.skip({ ctx, path: job.path, scope: job.scope, reason: EQualitySkipReason.DecisionUnavailable, detail: describeError(error) })
    }
  }
}
