import {
  EQualityReviewStatus,
  EQualitySkipReason,
  eventBodySchema,
  type CallId,
  type CodeQualityReviewedBody,
  type Event,
  type EventDraft,
  type LogPort,
  type QualityReviewPort,
  type RunId,
  type ThreadId,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { createQualityBudget, settleReview } from '../quality/deadline'
import { logFieldsOf } from '../store/logs'

export const QUALITY_REVIEW_BUDGET_MS = 1000

const UNIDENTIFIED_NAMESPACE = 'unidentified'

const NUDGE_LIFETIME_STEPS = 1

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export type QualityReviewOutcome = {
  reviews: readonly CodeQualityReviewedBody[]
  nudge: EventDraft | undefined
}

const NO_REVIEW: QualityReviewOutcome = { reviews: [], nudge: undefined }

function containedLog(args: {
  logPort: LogPort | undefined
  message: string
  threadId: ThreadId
  error?: unknown
}): void {
  try {
    args.logPort?.error({
      source: 'tools.quality',
      message: args.message,
      threadId: args.threadId,
      ...('error' in args ? logFieldsOf({ error: args.error }) : {}),
    })
  } catch {
    return
  }
}

function reviewOutcomeOf(args: { value: unknown; callId: CallId }): QualityReviewOutcome | undefined {
  if (!Array.isArray(args.value)) return undefined
  const reviews: CodeQualityReviewedBody[] = []
  let nudge: EventDraft | undefined
  for (const candidate of args.value) {
    const parsed = eventBodySchema.safeParse(candidate)
    if (!parsed.success) return undefined
    const draft = parsed.data
    if (draft.type === 'code-quality-reviewed') {
      if (draft.callId !== args.callId) return undefined
      reviews.push(draft)
      continue
    }
    if (draft.type === 'nudge') {
      if (nudge !== undefined || draft.lifetimeSteps !== NUDGE_LIFETIME_STEPS) return undefined
      nudge = draft
      continue
    }
    return undefined
  }
  return { reviews, nudge }
}

function bookkeeping(args: {
  call: ToolCall
  path: string
  status: EQualityReviewStatus
  reason?: EQualitySkipReason
  detail: string
  startedAt: number
}): CodeQualityReviewedBody {
  return {
    type: 'code-quality-reviewed',
    callId: args.call.callId,
    workspaceNamespace: UNIDENTIFIED_NAMESPACE,
    path: args.path,
    beforeHash: null,
    afterHash: null,
    status: args.status,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    detail: args.detail,
    assessments: [],
    findings: [],
    durationMs: Math.max(0, Date.now() - args.startedAt),
  }
}

const deadlineBookkeeping = (args: {
  call: ToolCall
  path: string
  startedAt: number
  budgetMs: number
}): CodeQualityReviewedBody =>
  bookkeeping({
    ...args,
    status: EQualityReviewStatus.OperationalError,
    reason: EQualitySkipReason.ReviewDeadline,
    detail: `review exceeded ${args.budgetMs}ms`,
  })

async function qualityReviewFor(args: {
  quality: QualityReviewPort | undefined
  logPort: LogPort | undefined
  call: ToolCall
  runId: RunId
  result: ToolOutcome
  events: readonly Event[]
  projectDirectory: string
  signal: AbortSignal
  budgetMs: number
}): Promise<QualityReviewOutcome> {
  const { quality, call, result } = args
  if (quality === undefined || !result.ok) return NO_REVIEW
  const changes = result.fileChanges ?? []
  const captureFaults = result.fileChangeFaults ?? []
  if (changes.length === 0 && captureFaults.length === 0) return NO_REVIEW

  const startedAt = Date.now()
  const path = changes[0]?.path ?? captureFaults[0]?.path ?? call.name

  const budget = createQualityBudget({ signal: args.signal, budgetMs: args.budgetMs })
  const raced = await settleReview({
    budget,
    work: (signal) =>
      quality.review({
        call,
        runId: args.runId,
        changes,
        captureFaults,
        events: args.events,
        projectDirectory: args.projectDirectory,
        signal,
        deadlineAt: budget.deadlineAt,
      }),
  }).finally(budget.dispose)

  if (raced.kind === 'completed') {
    const valid = reviewOutcomeOf({ value: raced.value, callId: call.callId })
    if (raced.afterDeadline) {
      const late = valid?.reviews.filter((record) => record.status !== EQualityReviewStatus.Completed) ?? []
      if (late.length > 0) return { reviews: late, nudge: undefined }
      return { reviews: [deadlineBookkeeping({ call, path, startedAt, budgetMs: args.budgetMs })], nudge: undefined }
    }
    if (valid !== undefined) return valid
    containedLog({
      logPort: args.logPort,
      message: `the quality review of the ${call.name} call returned drafts that failed validation`,
      threadId: call.threadId,
    })
    return {
      reviews: [
        bookkeeping({
          call,
          path,
          startedAt,
          status: EQualityReviewStatus.OperationalError,
          detail: 'review returned malformed records and they were dropped',
        }),
      ],
      nudge: undefined,
    }
  }

  if (raced.kind === 'deadline') {
    return { reviews: [deadlineBookkeeping({ call, path, startedAt, budgetMs: args.budgetMs })], nudge: undefined }
  }

  if (raced.kind === 'aborted') {
    return {
      reviews: [
        bookkeeping({
          call,
          path,
          startedAt,
          status: EQualityReviewStatus.Skipped,
          reason: EQualitySkipReason.TurnInterrupted,
          detail: 'the turn was interrupted before the review finished',
        }),
      ],
      nudge: undefined,
    }
  }

  containedLog({
    logPort: args.logPort,
    message: `the quality review of the ${call.name} call threw`,
    threadId: call.threadId,
    error: raced.error,
  })
  return {
    reviews: [
      bookkeeping({
        call,
        path,
        startedAt,
        status: EQualityReviewStatus.OperationalError,
        detail: `review failed: ${messageOf(raced.error)}`,
      }),
    ],
    nudge: undefined,
  }
}

export class QualityStage {
  constructor(
    private readonly deps: {
      quality: QualityReviewPort | undefined
      logPort: LogPort | undefined
      budgetMs?: number
    },
  ) {}

  captureEnabled({ threadId }: { threadId: ThreadId }): boolean {
    const { quality, logPort } = this.deps
    if (quality === undefined) return false
    try {
      return quality.captureEnabled() === true
    } catch (error) {
      containedLog({
        logPort,
        message: 'the quality review port could not say whether to capture file changes',
        threadId,
        error,
      })
      return false
    }
  }

  review(args: {
    call: ToolCall
    runId: RunId
    result: ToolOutcome
    events: readonly Event[]
    projectDirectory: string
    signal: AbortSignal
  }): Promise<QualityReviewOutcome> {
    return qualityReviewFor({ ...this.deps, ...args, budgetMs: this.deps.budgetMs ?? QUALITY_REVIEW_BUDGET_MS })
  }
}
