import {
  EQualityReviewStatus,
  EQualitySkipReason,
  eventBodySchema,
  type CallId,
  type CodeQualityReviewedBody,
  type Event,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { createQualityBudget, settleReview } from '../review/deadline'
import { NO_REVIEW_RESULT, type QualityReviewResult } from '../review/engine'
import type { ReviewArgs } from '../review/review-context'

export type ReviewLog = (message: string) => void

export type QualityReviewRun = {
  review(args: ReviewArgs): Promise<QualityReviewResult>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export function outcomeOf(args: {
  value: QualityReviewResult
  callId: CallId
}): QualityReviewResult | undefined {
  const records: CodeQualityReviewedBody[] = []
  for (const record of args.value.records) {
    const parsed = eventBodySchema.safeParse(record)
    if (!parsed.success || parsed.data.type !== 'code-quality-reviewed') return undefined
    if (parsed.data.callId !== args.callId) return undefined
    records.push(parsed.data)
  }
  const { context } = args.value
  if (context !== undefined && context.trim() === '') return undefined
  return { records, context }
}

function bookkeeping(args: {
  call: ToolCall
  workspaceNamespace: string
  path: string
  status: EQualityReviewStatus
  reason?: EQualitySkipReason | undefined
  detail: string
  startedAt: number
  now: () => number
}): CodeQualityReviewedBody {
  return {
    type: 'code-quality-reviewed',
    callId: args.call.callId,
    workspaceNamespace: args.workspaceNamespace,
    path: args.path,
    beforeHash: null,
    afterHash: null,
    status: args.status,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    detail: args.detail,
    assessments: [],
    findings: [],
    durationMs: Math.max(0, args.now() - args.startedAt),
  }
}

const deadlineBookkeeping = (args: {
  call: ToolCall
  workspaceNamespace: string
  path: string
  startedAt: number
  budgetMs: number
  now: () => number
}): CodeQualityReviewedBody =>
  bookkeeping({
    ...args,
    status: EQualityReviewStatus.OperationalError,
    reason: EQualitySkipReason.ReviewDeadline,
    detail: `review exceeded ${args.budgetMs}ms`,
  })

export async function reviewWithinBudget(args: {
  review: QualityReviewRun
  clock: () => number
  log: ReviewLog | undefined
  call: ToolCall
  result: ToolOutcome
  events: readonly Event[]
  projectDirectory: string
  signal: AbortSignal
  budgetMs: number
}): Promise<QualityReviewResult> {
  const { call, result } = args
  const now = args.clock
  if (!result.ok) return NO_REVIEW_RESULT
  const changes = result.fileChanges ?? []
  const captureFaults = result.fileChangeFaults ?? []
  if (changes.length === 0 && captureFaults.length === 0) return NO_REVIEW_RESULT

  const startedAt = now()
  const path = changes[0]?.path ?? captureFaults[0]?.path ?? call.name
  const workspaceNamespace = args.projectDirectory
  const bookkeepingFacts = {
    call,
    workspaceNamespace,
    path,
    startedAt,
    now,
  }

  const budget = createQualityBudget({ signal: args.signal, budgetMs: args.budgetMs, now })
  const raced = await settleReview({
    budget,
    work: (signal) =>
      args.review.review({
        call,
        changes,
        captureFaults,
        events: args.events,
        projectDirectory: args.projectDirectory,
        signal,
        deadlineAt: budget.deadlineAt,
      }),
  }).finally(budget.dispose)

  if (raced.kind === 'completed') {
    const valid = outcomeOf({ value: raced.value, callId: call.callId })
    if (raced.afterDeadline) {
      const late =
        valid?.records.filter((record) => record.status !== EQualityReviewStatus.Completed) ?? []
      if (late.length > 0) return { records: late, context: undefined }
      return {
        records: [deadlineBookkeeping({ ...bookkeepingFacts, budgetMs: args.budgetMs })],
        context: undefined,
      }
    }
    if (valid !== undefined) return valid
    args.log?.(
      `the quality review of the ${call.name} call returned records that failed validation`,
    )
    return {
      records: [
        bookkeeping({
          ...bookkeepingFacts,
          status: EQualityReviewStatus.OperationalError,
          detail: 'review returned malformed records and they were dropped',
        }),
      ],
      context: undefined,
    }
  }

  if (raced.kind === 'deadline') {
    return {
      records: [deadlineBookkeeping({ ...bookkeepingFacts, budgetMs: args.budgetMs })],
      context: undefined,
    }
  }

  if (raced.kind === 'aborted') {
    return {
      records: [
        bookkeeping({
          ...bookkeepingFacts,
          status: EQualityReviewStatus.Skipped,
          reason: EQualitySkipReason.TurnInterrupted,
          detail: 'the turn was interrupted before the review finished',
        }),
      ],
      context: undefined,
    }
  }

  args.log?.(`the quality review of the ${call.name} call threw: ${messageOf(raced.error)}`)
  return {
    records: [
      bookkeeping({
        ...bookkeepingFacts,
        status: EQualityReviewStatus.OperationalError,
        detail: `review failed: ${messageOf(raced.error)}`,
      }),
    ],
    context: undefined,
  }
}
