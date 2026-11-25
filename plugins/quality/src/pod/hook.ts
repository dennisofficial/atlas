import type { AfterToolHook, RegisteredHook } from '@dltech/atlas-agent'
import {
  ESettingId,
  EStage,
  EToolEffect,
  type AfterTurn,
  type Event,
  type RecordEvent,
} from '@dltech/atlas-core'
import { EAnalyticsLinks, type PluginPodContext } from '@dltech/atlas-plugin-sdk'

import { CodeQualityReview } from '../review/engine'
import { qualityRegistry } from '../review/registry'
import { prepareQualityScopes } from '../review/source'
import { closedFindingProperties } from './analytics/closed-properties'
import { nudgingReviewIdsOf, rememberNudgedFindings } from './analytics/nudge-review'
import { nudgeReactionProperties, QUALITY_NUDGE_REACTION } from './analytics/reaction-properties'
import { newReviewId, type QualityNotified } from './analytics/review-links'
import {
  QUALITY_FINDING_CLOSED,
  QUALITY_FINDING_RESOLVED,
  QUALITY_REVIEW_COMPLETED,
  resolvedFindingProperties,
  reviewCompletedProperties,
} from './analytics/review-properties'
import { QUALITY_SCOPE_ASSESSED, scopeAssessedProperties } from './analytics/scope-properties'
import {
  EQualityUnavailableReason,
  QUALITY_REVIEW_UNAVAILABLE,
  reportUnavailableOnce,
  unavailableProperties,
} from './analytics/unavailable'
import { noteDraftsOf, retirementDraftsOf } from './notes'
import { reviewWithinBudget } from './review-outcome'
import { tracedClassifier } from './traced-classifier'

export const QUALITY_REVIEW_BUDGET_MS = 1000

export type QualitySettings = {
  enabled: boolean
  policies: Readonly<Record<string, boolean>>
}

export type QualityReviewOptions = {
  settings: (ctx: PluginPodContext) => Promise<QualitySettings>
  budgetMs: number
  clock: () => number
}

const coreEventsOf = (events: readonly RecordEvent[]): readonly Event[] =>
  events.flatMap((event): readonly Event[] => {
    if (event.type === 'code-quality-reviewed') return [event]
    if (event.type === 'tool-result') return [event]
    return []
  })

const captureUnavailable = (args: {
  ctx: PluginPodContext
  reason: EQualityUnavailableReason
}): void => {
  if (!reportUnavailableOnce({ sessionId: args.ctx.sessionId, reason: args.reason })) return
  args.ctx.analytics.capture({
    event: QUALITY_REVIEW_UNAVAILABLE,
    properties: unavailableProperties({ reason: args.reason }),
    links: EAnalyticsLinks.Hashed,
  })
}

export const qualityReviewHook = (args: {
  ctx: PluginPodContext
  options: QualityReviewOptions
}): AfterToolHook => ({
  name: 'quality-review',
  order: { stage: EStage.Observe, nudge: 20 },
  capturesFileChanges: async ({ call }) => {
    if (call.effect !== EToolEffect.Write) return false
    if (!args.ctx.classifier.status().on) {
      captureUnavailable({ ctx: args.ctx, reason: EQualityUnavailableReason.ClassifierOff })
      return false
    }
    if (!(await args.options.settings(args.ctx)).enabled) {
      captureUnavailable({ ctx: args.ctx, reason: EQualityUnavailableReason.SettingOff })
      return false
    }
    return true
  },
  run: async ({ call, result, projectDirectory, signal }) => {
    const status = args.ctx.classifier.status()
    if (!status.on) {
      captureUnavailable({ ctx: args.ctx, reason: EQualityUnavailableReason.ClassifierOff })
      return {}
    }
    if (!result.ok) return {}
    const changes = result.fileChanges ?? []
    const captureFaults = result.fileChangeFaults ?? []
    if (changes.length === 0 && captureFaults.length === 0) return {}

    const settings = await args.options.settings(args.ctx)
    if (!settings.enabled) {
      captureUnavailable({ ctx: args.ctx, reason: EQualityUnavailableReason.SettingOff })
      return {}
    }

    const reviewId = newReviewId()
    const review = new CodeQualityReview({
      classifier: tracedClassifier({
        classifier: args.ctx.classifier,
        analytics: args.ctx.analytics,
        reviewId,
        status,
        clock: args.options.clock,
      }),
      requestedModel: status.model,
      source: { prepareQualityScopes },
      registry: qualityRegistry,
      settings: () => ({ ...settings.policies, [ESettingId.QualityEnabled]: settings.enabled }),
      clock: args.options.clock,
      deadlineMs: args.options.budgetMs,
    })

    const events = args.ctx.events()
    const startedAt = args.options.clock()
    const attempted = await reviewWithinBudget({
      review,
      clock: args.options.clock,
      log: (message) => args.ctx.log(message),
      call,
      result,
      events: coreEventsOf(events),
      projectDirectory,
      signal,
      budgetMs: args.options.budgetMs,
    })
    const outcome =
      attempted.timings.totalMs === 0
        ? {
            ...attempted,
            timings: {
              ...attempted.timings,
              totalMs: Math.max(0, args.options.clock() - startedAt),
            },
          }
        : attempted

    const factsById = new Map(outcome.scopes.map((facts) => [facts.scopeId, facts]))
    const nudged: readonly QualityNotified[] = outcome.flagged.map(({ entry }) => ({
      policyId: entry.policy.id,
      scopeId: entry.assessment.scopeId,
    }))
    rememberNudgedFindings({
      sessionId: args.ctx.sessionId,
      reviewId,
      findingIds: outcome.flagged.map(({ entry }) => entry.finding.id),
    })

    for (const record of outcome.records) {
      const facts = record.scope === undefined ? undefined : factsById.get(record.scope.id)
      if (facts === undefined) continue
      for (const assessment of record.assessments) {
        args.ctx.analytics.capture({
          event: QUALITY_SCOPE_ASSESSED,
          properties: scopeAssessedProperties({
            reviewId,
            record,
            assessment,
            facts,
            notified: nudged,
          }),
          links: EAnalyticsLinks.Hashed,
        })
      }
    }

    args.ctx.analytics.capture({
      event: QUALITY_REVIEW_COMPLETED,
      properties: reviewCompletedProperties({
        reviewId,
        records: outcome.records,
        metrics: outcome,
        files: changes.length,
        notified: outcome.notes.length > 0,
        nudged,
        tool: call.name.toLowerCase(),
        classifier: { model: status.model, provider: status.provider },
        events,
      }),
      links: EAnalyticsLinks.Hashed,
    })

    for (const properties of resolvedFindingProperties({
      reviewId,
      records: outcome.records,
      events,
      threadId: call.threadId,
    })) {
      args.ctx.analytics.capture({
        event: QUALITY_FINDING_RESOLVED,
        properties,
        links: EAnalyticsLinks.Hashed,
      })
    }
    for (const properties of closedFindingProperties({
      reviewId,
      records: outcome.records,
      events,
      threadId: call.threadId,
    })) {
      args.ctx.analytics.capture({
        event: QUALITY_FINDING_CLOSED,
        properties,
        links: EAnalyticsLinks.Hashed,
      })
    }

    return {
      drafts: [
        ...outcome.records,
        ...noteDraftsOf({ notes: outcome.notes }),
        ...retirementDraftsOf({ events, records: outcome.records, notes: outcome.notes }),
      ],
    }
  },
})

export const qualityNudgeReactionHook = (args: {
  ctx: PluginPodContext
}): RegisteredHook<AfterTurn> => ({
  name: 'quality-nudge-reaction',
  order: { stage: EStage.Observe, nudge: 20 },
  run: async ({ threadId }) => {
    const properties = nudgeReactionProperties({
      events: args.ctx.events(),
      threadId,
      reviewIds: nudgingReviewIdsOf({ sessionId: args.ctx.sessionId }),
    })
    for (const held of properties) {
      args.ctx.analytics.capture({
        event: QUALITY_NUDGE_REACTION,
        properties: held,
        links: EAnalyticsLinks.Hashed,
      })
    }
    return {}
  },
})
