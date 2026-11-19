import { z } from 'zod'

import { ECheckOutcome, EChecksState, checkRunOutcomeOf, statusContextOutcomeOf } from './checks'

export enum EPrState {
  Open = 'open',
  Draft = 'draft',
  Closed = 'closed',
  Merged = 'merged',
}

export enum EPrSource {
  WebhookPull = 'webhook:pull',
  DeliveryFill = 'delivery:fill',
  Poll = 'poll',
  HeadDiscovery = 'head-discovery',
  SubscribePull = 'subscribe-pull',
}

export enum ECheckSource {
  Run = 'run',
  Status = 'status',
}

const timestamp = z.string().min(1)

export const pullSampleSchema = z.object({
  repoFullName: z.string().min(1),
  prNumber: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.enum(EPrState),
  headBranch: z.string(),
  headSha: z.string().min(1),
  headRepoFullName: z.string().min(1).nullable(),
  baseBranch: z.string().min(1),
  pullUpdatedAt: timestamp.nullable(),
  closedAt: timestamp.nullable(),
  mergedAt: timestamp.nullable(),
})

export type PullSample = z.infer<typeof pullSampleSchema>

export const mergeabilitySampleSchema = z.object({
  headSha: z.string().min(1),
  baseBranch: z.string().min(1),
  mergeable: z.boolean().nullable(),
  mergeClean: z.boolean().nullable(),
  observedAt: timestamp,
})

export type MergeabilitySample = z.infer<typeof mergeabilitySampleSchema>

export const prObservationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pull'),
    source: z.enum(EPrSource),
    observedAt: timestamp,
    sample: pullSampleSchema,
  }),
  z.object({
    kind: z.literal('mergeability'),
    source: z.enum(EPrSource),
    observedAt: timestamp,
    sample: mergeabilitySampleSchema,
  }),
])

export type PrObservation = z.infer<typeof prObservationSchema>

export const checkRunSampleSchema = z.object({
  source: z.literal(ECheckSource.Run),
  id: z.number().int(),
  name: z.string(),
  appSlug: z.string().nullable(),
  headSha: z.string().min(1),
  status: z.string(),
  conclusion: z.string().nullable(),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
})

export type CheckRunSample = z.infer<typeof checkRunSampleSchema>

export const statusSampleSchema = z.object({
  source: z.literal(ECheckSource.Status),
  id: z.number().int(),
  context: z.string().min(1),
  state: z.string(),
  headSha: z.string().min(1),
  createdAt: timestamp,
})

export type StatusSample = z.infer<typeof statusSampleSchema>

export const checkSampleSchema = z.discriminatedUnion('source', [
  checkRunSampleSchema,
  statusSampleSchema,
])

export type CheckSample = z.infer<typeof checkSampleSchema>

export const derivedChecksSchema = z.object({
  headSha: z.string().min(1).nullable(),
  running: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  ignored: z.number().int().nonnegative(),
  rollup: z.enum(EChecksState).nullable(),
  requiredContexts: z.array(z.string()).readonly(),
})

export type DerivedChecks = z.infer<typeof derivedChecksSchema>

export function pullStateOfSample(args: {
  state: string
  draft: boolean
  mergedAt: string | null
}): EPrState {
  if (args.state === 'open') return args.draft ? EPrState.Draft : EPrState.Open

  return args.mergedAt === null ? EPrState.Closed : EPrState.Merged
}

export function checkOutcomeOfSample(sample: CheckSample): ECheckOutcome {
  if (sample.source === ECheckSource.Run) {
    return checkRunOutcomeOf({ status: sample.status, conclusion: sample.conclusion })
  }

  return statusContextOutcomeOf(sample.state)
}

const pullPayloadSchema = z.object({
  pull_request: z.object({
    number: z.number().int(),
    title: z.string(),
    html_url: z.string(),
    state: z.string(),
    draft: z.boolean(),
    merged_at: z.string().nullable(),
    closed_at: z.string().nullable(),
    updated_at: timestamp,
    mergeable: z.boolean().nullable().optional(),
    mergeable_state: z.string().optional(),
    base: z.object({
      ref: z.string().min(1),
      repo: z.object({ full_name: z.string().min(1) }),
    }),
    head: z.object({
      ref: z.string(),
      sha: z.string().min(1),
      repo: z
        .object({ full_name: z.string().min(1) })
        .nullable()
        .optional(),
    }),
  }),
})

const checkRunPayloadSchema = z.object({
  check_run: z.object({
    id: z.number().int(),
    name: z.string(),
    head_sha: z.string().min(1),
    status: z.string(),
    conclusion: z.string().nullable(),
    started_at: timestamp.nullable().optional(),
    completed_at: timestamp.nullable().optional(),
    app: z.object({ slug: z.string() }).nullable().optional(),
  }),
})

const statusPayloadSchema = z.object({
  id: z.number().int(),
  context: z.string().min(1),
  state: z.string(),
  sha: z.string().min(1),
  created_at: timestamp,
})

export function pullSampleOfPayload(payload: unknown): PullSample | null {
  const parsed = pullPayloadSchema.safeParse(payload)
  if (!parsed.success) return null
  const pull = parsed.data.pull_request

  return {
    repoFullName: pull.base.repo.full_name,
    prNumber: pull.number,
    title: pull.title,
    url: pull.html_url,
    state: pullStateOfSample({
      state: pull.state,
      draft: pull.draft,
      mergedAt: pull.merged_at,
    }),
    headBranch: pull.head.ref,
    headSha: pull.head.sha,
    headRepoFullName: pull.head.repo?.full_name ?? null,
    baseBranch: pull.base.ref,
    pullUpdatedAt: pull.updated_at,
    closedAt: pull.closed_at,
    mergedAt: pull.merged_at,
  }
}

export function mergeabilitySampleOfPayload(args: {
  observedAt: string
  payload: unknown
}): MergeabilitySample | null {
  const parsed = pullPayloadSchema.safeParse(args.payload)
  if (!parsed.success) return null
  const pull = parsed.data.pull_request
  const mergeable = pull.mergeable ?? null

  return {
    headSha: pull.head.sha,
    baseBranch: pull.base.ref,
    mergeable,
    mergeClean: mergeable === null ? null : pull.mergeable_state === 'clean',
    observedAt: args.observedAt,
  }
}

export function checkSampleOfPayload(payload: unknown): CheckSample | null {
  const run = checkRunPayloadSchema.safeParse(payload)
  if (run.success) {
    const check = run.data.check_run

    return {
      source: ECheckSource.Run,
      id: check.id,
      name: check.name,
      appSlug: check.app?.slug ?? null,
      headSha: check.head_sha,
      status: check.status,
      conclusion: check.conclusion,
      startedAt: check.started_at ?? null,
      completedAt: check.completed_at ?? null,
    }
  }

  const status = statusPayloadSchema.safeParse(payload)
  if (!status.success) return null

  return {
    source: ECheckSource.Status,
    id: status.data.id,
    context: status.data.context,
    state: status.data.state,
    headSha: status.data.sha,
    createdAt: status.data.created_at,
  }
}
