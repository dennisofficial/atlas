import {
  attachmentSchema,
  EAttachmentStore,
  EMessageOrigin,
  ESessionStatus,
  MAX_MESSAGE_UPLOADS,
  parseRef,
  saidUploadSchema,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { changeFileStatusSchema, changeSideSchema } from './changes-state'
import { METRICS_RING_SIZE, podSampleSchema } from './ops/metrics'
import { sessionCommandRowSchema } from './command-row'
import { inboxMediaSchema, sessionPostMediaListSchema } from './media'

export const sessionListInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

const storedAttachmentSchema = attachmentSchema.refine(
  (attachment) => attachment.content.store !== EAttachmentStore.Inline,
  'a posted attachment is an upload or stored media',
)

const messageDraftFields = {
  text: z.string().max(1_000_000),
  clientId: z.string().min(1).max(200).optional(),
  media: sessionPostMediaListSchema.optional(),
  uploads: z.array(saidUploadSchema).max(MAX_MESSAGE_UPLOADS).optional(),
  attachments: z.array(storedAttachmentSchema).max(MAX_MESSAGE_UPLOADS).optional(),
}

type MessageDraftShape = {
  text: string
  media?: readonly unknown[] | undefined
  uploads?: readonly unknown[] | undefined
  attachments?: readonly unknown[] | undefined
}

const hasMessageContent = (input: MessageDraftShape): boolean =>
  input.text.trim().length > 0 ||
  (input.media?.length ?? 0) > 0 ||
  (input.uploads?.length ?? 0) > 0 ||
  (input.attachments?.length ?? 0) > 0

const withinAttachmentLimit = (input: MessageDraftShape): boolean =>
  (input.media?.length ?? 0) + (input.uploads?.length ?? 0) + (input.attachments?.length ?? 0) <=
  MAX_MESSAGE_UPLOADS

export const messageDraftSchema = z
  .strictObject(messageDraftFields)
  .refine(hasMessageContent, 'a message needs text or an attachment')
  .refine(withinAttachmentLimit, `a message carries at most ${MAX_MESSAGE_UPLOADS} attachments`)

export const sessionPostInputSchema = z
  .strictObject({ sessionId: z.string().min(1), ...messageDraftFields })
  .refine(hasMessageContent, 'a message needs text or an attachment')
  .refine(withinAttachmentLimit, `a message carries at most ${MAX_MESSAGE_UPLOADS} attachments`)

export enum ESandboxProvider {
  Vercel = 'vercel',
  Agent37 = 'agent37',
}

export const DEFAULT_SANDBOX_PROVIDER = ESandboxProvider.Agent37

export enum ECredentialSource {
  Byok = 'byok',
  Platform = 'platform',
}

export enum ESandboxStatus {
  Provisioning = 'provisioning',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Starting = 'starting',
  Restarting = 'restarting',
  Updating = 'updating',
  Sleeping = 'sleeping',
  Waking = 'waking',
  Failed = 'failed',
  Deleting = 'deleting',
  Deleted = 'deleted',
}

export const sessionCreateInputSchema = z.strictObject({
  projectId: z.string().min(1).nullish(),
  title: z.string().optional(),
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  fast: z.boolean().optional(),
  provider: z.nativeEnum(ESandboxProvider).optional(),
  firstMessage: messageDraftSchema.optional(),
})

export const sessionEventsInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  maxBytes: z.number().int().min(1).max(3_000_000).optional(),
})

export const sessionBlobInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  hash: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  length: z.number().int().min(1).max(2_000_000).optional(),
})

export const sessionWithdrawInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  inboxId: z.number().int().min(1),
})

export const sessionArchiveInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  archived: z.boolean(),
})

export const sessionMarkReadInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  seq: z.number().int().min(0),
})

export const sessionStatusInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>
export type SessionMessageDraft = z.infer<typeof messageDraftSchema>
export type SessionListInput = z.infer<typeof sessionListInputSchema>
export type SessionPostInput = z.infer<typeof sessionPostInputSchema>
export type SessionEventsInput = z.infer<typeof sessionEventsInputSchema>
export type SessionBlobInput = z.infer<typeof sessionBlobInputSchema>
export type SessionWithdrawInput = z.infer<typeof sessionWithdrawInputSchema>
export type SessionArchiveInput = z.infer<typeof sessionArchiveInputSchema>
export type SessionMarkReadInput = z.infer<typeof sessionMarkReadInputSchema>
export type SessionStatusInput = z.infer<typeof sessionStatusInputSchema>

export const inboxMessageSchema = z.strictObject({
  text: z.string(),
  clientId: z.string().min(1).max(200).optional(),
  via: z.nativeEnum(EMessageOrigin).optional(),
  media: z.array(inboxMediaSchema).optional(),
  uploads: z.array(saidUploadSchema).optional(),
  attachments: z.array(attachmentSchema).optional(),
})

export type InboxMessage = z.infer<typeof inboxMessageSchema>

export const INBOX_KIND_MESSAGE = 'message'

export const sessionCreateOutputSchema = z.strictObject({
  sessionId: z.string().min(1),
  mainThreadId: z.string().min(1),
})

export const sessionRowStatusSchema = z.strictObject({
  state: z.enum(ESessionStatus),
  reason: z.string().optional(),
  since: z.string().optional(),
})

export const prChecksSchema = z.strictObject({
  running: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  expected: z.number().int().min(0).optional(),
})

export const sessionRowPullRequestSchema = z.strictObject({
  repo: z.string().min(1),
  number: z.number().int().min(1),
  url: z.string().min(1),
  state: z.string().nullable(),
  checks: prChecksSchema.nullable(),
  mergeable: z.boolean().nullable(),
  mergeQueued: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
})

export const sessionModelChoiceSchema = z.strictObject({
  ref: z.string().min(1),
  effort: z.string().min(1),
  fast: z.boolean(),
})

export type SessionModelChoice = z.infer<typeof sessionModelChoiceSchema>

export const sessionModelChoiceOf = (row: {
  modelRef: string
  modelEffort: string
  modelFast: boolean
}): SessionModelChoice => ({
  ref: row.modelRef,
  effort: row.modelEffort,
  fast: row.modelFast,
})

export const sessionSandboxStatusSchema = z.strictObject({
  status: z.nativeEnum(ESandboxStatus),
  at: z.string().min(1),
  reason: z.string().optional(),
})

export type SessionSandboxStatus = z.infer<typeof sessionSandboxStatusSchema>

export const sessionSummarySchema = z.strictObject({
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable(),
  title: z.string().nullable(),
  naming: z.boolean(),
  mainThreadId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable(),
  lastAssistantSeq: z.number().int().min(0).optional(),
  readSeq: z.number().int().min(0).nullable().optional(),
  spawnedBy: z.string().min(1).nullable().optional(),
  nested: z.boolean().optional(),
  routineId: z.string().min(1).nullable().optional(),
  model: sessionModelChoiceSchema,
  status: sessionRowStatusSchema.optional(),
  primaryBranch: z.string().nullable().optional(),
  pullRequest: sessionRowPullRequestSchema.nullable().optional(),
  sandbox: sessionSandboxStatusSchema.nullable().optional(),
  sandboxProvider: z.enum(ESandboxProvider).optional(),
})

export const sessionListOutputSchema = z.strictObject({
  sessions: z.array(sessionSummarySchema),
})

export const sessionPostOutputSchema = z.strictObject({ inboxId: z.number().int().min(1) })

export const sessionEventsOutputSchema = z.strictObject({
  events: z.array(z.record(z.string(), z.unknown())),
  next: z.number().int().min(1).optional(),
})

export const sessionBlobOutputSchema = z.strictObject({
  size: z.number().int().min(0),
  offset: z.number().int().min(0),
  bytes: z.string(),
})

export const sessionLeaseSchema = z.strictObject({
  epoch: z.number().int().min(0),
  holderHostId: z.number().int().nullable(),
  live: z.boolean(),
})

export const QUEUED_MESSAGES_LIMIT = 20

export const sessionQueuedMessageSchema = z.strictObject({
  inboxId: z.number().int().min(1),
  text: z.string(),
  clientId: z.string().min(1).optional(),
  postedAt: z.string().min(1),
  media: z.array(inboxMediaSchema).optional(),
  uploads: z.array(saidUploadSchema).optional(),
  attachments: z.array(attachmentSchema).optional(),
})

export const EWithdrawRefusal = {
  AlreadyConsumed: 'already-consumed',
  Unknown: 'unknown',
} as const

export const sessionWithdrawOutputSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum([EWithdrawRefusal.AlreadyConsumed, EWithdrawRefusal.Unknown]),
  }),
])

export const sessionArchiveOutputSchema = z.strictObject({ archivedAt: z.string().nullable() })

export const sessionMarkReadOutputSchema = z.strictObject({
  readSeq: z.number().int().min(0),
})

export const podShapeSchema = z.strictObject({
  vcpus: z.number().int().min(1),
  memoryGb: z.number().int().min(1),
})

export type PodShapeOutput = z.infer<typeof podShapeSchema>

export const podShapeViewSchema = z.strictObject({
  vcpus: z.number().int().min(1),
  memoryGb: z.number().int().min(1).nullable(),
})

export type PodShapeViewOutput = z.infer<typeof podShapeViewSchema>

export const podSizingOutputSchema = z.strictObject({
  cap: z.number().int().min(1),
  offered: z.array(podShapeSchema),
  unavailable: z.array(z.strictObject({ shape: podShapeSchema, reason: z.string().min(1) })),
})

export const sessionStatusOutputSchema = z.strictObject({
  state: z.enum(ESessionStatus),
  reason: z.string().optional(),
  since: z.string().optional(),
  lease: sessionLeaseSchema,
  sandbox: sessionSandboxStatusSchema.nullable().optional(),
  sandboxProvider: z.enum(ESandboxProvider).optional(),
  credentialSource: z.enum(ECredentialSource).optional(),
  queued: z.array(sessionQueuedMessageSchema).optional(),
  commands: z.array(sessionCommandRowSchema).optional(),
  pod: z
    .strictObject({
      shape: podShapeViewSchema.optional(),
      desiredShape: podShapeSchema.optional(),
      desiredVcpus: z.number().int().min(1).optional(),
      actualVcpus: z.number().int().min(1).optional(),
      phase: z.enum(['steady', 'resizing', 'waiting', 'failed']),
      error: z.string().optional(),
      sizing: podSizingOutputSchema.optional(),
    })
    .optional(),
})

export const sessionRetryInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionStopInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionCommandInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
})

export const sessionWakeInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionWakeOutputSchema = z.strictObject({
  state: z.enum(['awake', 'waking', 'elsewhere']),
})
export type SessionWakeInput = z.infer<typeof sessionWakeInputSchema>
export type SessionWakeOutput = z.infer<typeof sessionWakeOutputSchema>

export const sessionSleepPodInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  force: z.boolean().optional(),
})

export const sessionSleepPodOutputSchema = z.strictObject({ state: z.enum(['sleeping']) })
export type SessionSleepPodInput = z.infer<typeof sessionSleepPodInputSchema>
export type SessionSleepPodOutput = z.infer<typeof sessionSleepPodOutputSchema>

export const sessionHoldPodInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionHoldPodOutputSchema = z.strictObject({
  held: z.boolean(),
})
export type SessionHoldPodInput = z.infer<typeof sessionHoldPodInputSchema>
export type SessionHoldPodOutput = z.infer<typeof sessionHoldPodOutputSchema>

export const sessionViewInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionPodResourcesInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const sessionPodResourcesOutputSchema = z
  .strictObject({
    vcpus: z.number().int().min(1).optional(),
    memoryMb: z.number().int().min(1).optional(),
    pendingVcpus: z.number().int().min(1).optional(),
  })
  .nullable()

export type SessionPodResourcesInput = z.infer<typeof sessionPodResourcesInputSchema>
export type SessionPodResourcesOutput = z.infer<typeof sessionPodResourcesOutputSchema>

export const sessionPodMetricsInputSchema = z.strictObject({
  sessionId: z.string().min(1),
})

export const podMetricsFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('samples'),
    samples: z.array(podSampleSchema).max(METRICS_RING_SIZE),
  }),
  z.strictObject({ type: z.literal('sample'), sample: podSampleSchema }),
  z.strictObject({ type: z.literal('unavailable'), reason: z.string() }),
])

export type SessionPodMetricsInput = z.infer<typeof sessionPodMetricsInputSchema>
export type PodMetricsFrame = z.infer<typeof podMetricsFrameSchema>

const isPodMetricsStream = (value: unknown): value is AsyncIterable<PodMetricsFrame> =>
  typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'

export const podMetricsStreamOutputSchema =
  z.custom<AsyncIterable<PodMetricsFrame>>(isPodMetricsStream)

export const sessionRetryOutputSchema = z.strictObject({ inboxId: z.number().int().min(1) })

export const sessionStopOutputSchema = z.strictObject({ inboxId: z.number().int().min(1) })

export const sessionCommandOutputSchema = z.strictObject({
  inboxId: z.number().int().min(1).optional(),
})

const tokenSpendShape = {
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
  cacheWriteTokens: z.number().int().min(0),
}

export const sessionSpendRowSchema = z.strictObject({
  providerId: z.string(),
  modelId: z.string(),
  ...tokenSpendShape,
  costUsd: z.number().min(0).optional(),
  unpricedTokens: z.strictObject(tokenSpendShape).optional(),
})

export const sessionSpendTallySchema = z.strictObject({
  ...tokenSpendShape,
  uncachedInputTokens: z.number().int(),
  costUsd: z.number().nullable(),
})

export const sessionContextMeterSchema = z.strictObject({
  used: z.number().min(0).nullable(),
  window: z.number().nullable(),
  measuredThroughSeq: z.number().int().nullable(),
})

export const sessionCheckoutsSchema = z.strictObject({
  repos: z.array(
    z.strictObject({
      repo: z.string(),
      base: z.string().nullable(),
      head: z.string().nullable(),
      branches: z.array(
        z.strictObject({
          name: z.string(),
          sha: z.string(),
          worktreePath: z.string().nullable(),
        }),
      ),
    }),
  ),
  primary: z.strictObject({ repo: z.string(), branch: z.string() }).nullable(),
})

export const sessionPullRequestStateSchema = z.strictObject({
  title: z.string(),
  state: z.string(),
  headSha: z.string(),
  checks: prChecksSchema,
  mergeable: z.boolean().nullable(),
  mergeQueued: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  updatedAt: z.string(),
})

export const sessionLinkedPullRequestSchema = z.strictObject({
  repo: z.string().min(1),
  number: z.number().int().min(1),
  url: z.string().min(1),
  branch: z.string(),
  state: sessionPullRequestStateSchema.nullable(),
})

export const sessionViewOutputSchema = z.strictObject({
  at: z.number().int().min(0),
  status: sessionStatusOutputSchema,
  context: sessionContextMeterSchema.nullable(),
  spend: z.strictObject({
    rows: z.array(sessionSpendRowSchema),
    tally: sessionSpendTallySchema,
  }),
  compute: z.strictObject({
    costUsd: z.number().nullable(),
    running: z.boolean(),
    tick: z
      .strictObject({ at: z.number().int().min(0), rateUsdPerHour: z.number().min(0) })
      .nullable(),
  }),
  checkouts: sessionCheckoutsSchema,
  pullRequests: z.array(sessionLinkedPullRequestSchema),
  pluginViews: z.record(z.string(), z.unknown()),
})

export type SessionRetryInput = z.infer<typeof sessionRetryInputSchema>
export type SessionRetryOutput = z.infer<typeof sessionRetryOutputSchema>
export type SessionStopInput = z.infer<typeof sessionStopInputSchema>
export type SessionStopOutput = z.infer<typeof sessionStopOutputSchema>
export type SessionCommandInput = z.infer<typeof sessionCommandInputSchema>
export type SessionCommandOutput = z.infer<typeof sessionCommandOutputSchema>
export const changedFileSchema = z.strictObject({
  path: z.string().min(1),
  oldPath: z.string().min(1).nullable(),
  status: changeFileStatusSchema,
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  binary: z.boolean(),
  size: z.number().int().min(0).nullable(),
  baseHash: z.string().min(1).nullable(),
  currentHash: z.string().min(1).nullable(),
})

export const sessionChangesInputSchema = z.strictObject({ sessionId: z.string().min(1) })

export const sessionChangesOutputSchema = z.strictObject({
  checkouts: z.array(
    z.strictObject({
      checkoutId: z.string().min(1),
      repo: z.string().min(1),
      worktreePath: z.string().min(1),
      base: z.string().min(1).nullable(),
      updatedAt: z.number().int().min(0),
      files: z.array(changedFileSchema),
    }),
  ),
})

export const sessionChangeContentInputSchema = z.strictObject({
  sessionId: z.string().min(1),
  checkoutId: z.string().min(1),
  path: z.string().min(1),
  side: changeSideSchema,
})

export const sessionChangeContentOutputSchema = z.strictObject({
  url: z.string().min(1),
  hash: z.string().min(1),
  size: z.number().int().min(0),
  validUntil: z.number().int().min(0),
})

export type ChangedFile = z.infer<typeof changedFileSchema>
export type SessionChangesInput = z.infer<typeof sessionChangesInputSchema>
export type SessionChangesOutput = z.infer<typeof sessionChangesOutputSchema>
export type SessionChangeContentInput = z.infer<typeof sessionChangeContentInputSchema>
export type SessionChangeContentOutput = z.infer<typeof sessionChangeContentOutputSchema>

export type SessionViewInput = z.infer<typeof sessionViewInputSchema>
export type SessionViewOutput = z.infer<typeof sessionViewOutputSchema>
export type SessionCreateOutput = z.infer<typeof sessionCreateOutputSchema>
export type SessionSummary = z.infer<typeof sessionSummarySchema>
export type SessionListOutput = z.infer<typeof sessionListOutputSchema>
export type SessionPostOutput = z.infer<typeof sessionPostOutputSchema>
export type SessionEventsOutput = z.infer<typeof sessionEventsOutputSchema>
export type SessionBlobOutput = z.infer<typeof sessionBlobOutputSchema>
export type SessionLeaseView = z.infer<typeof sessionLeaseSchema>
export type SessionQueuedMessage = z.infer<typeof sessionQueuedMessageSchema>
export type SessionWithdrawOutput = z.infer<typeof sessionWithdrawOutputSchema>
export type SessionArchiveOutput = z.infer<typeof sessionArchiveOutputSchema>
export type SessionMarkReadOutput = z.infer<typeof sessionMarkReadOutputSchema>
export type SessionStatusOutput = z.infer<typeof sessionStatusOutputSchema>

export const hostExposePortInputSchema = z.strictObject({
  threadId: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
})

export const hostExposePortOutputSchema = z.strictObject({
  url: z.string().min(1),
  tunnelToken: z.string().min(1),
})

export type HostExposePortInput = z.infer<typeof hostExposePortInputSchema>
export type HostExposePortOutput = z.infer<typeof hostExposePortOutputSchema>

export const routineRunOutcomeSchema = z.enum(['started', 'skipped-busy', 'skipped', 'failed'])

export const routineSchema = z.strictObject({
  routineId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  prompt: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  enabled: z.boolean(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  fast: z.boolean().nullable(),
  nextRunAt: z.string().min(1),
  lastRunAt: z.string().nullable(),
  lastSessionId: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const routineListInputSchema = z.strictObject({
  projectId: z.string().min(1).optional(),
})

export const routineListOutputSchema = z.strictObject({
  routines: z.array(routineSchema),
})

const routineModelRefSchema = z
  .string()
  .min(1)
  .refine(
    (reference) => parseRef(reference) !== undefined,
    'model must be a provider/model ref such as anthropic/claude-opus-5-5',
  )

export const routineCreateInputSchema = z.strictObject({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(20_000),
  cron: z.string().min(1).max(120),
  timezone: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  model: routineModelRefSchema.nullable().optional(),
  effort: z.string().min(1).nullable().optional(),
  fast: z.boolean().nullable().optional(),
})

export const routineUpdateInputSchema = z.strictObject({
  routineId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20_000).optional(),
  cron: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  model: routineModelRefSchema.nullable().optional(),
  effort: z.string().min(1).nullable().optional(),
  fast: z.boolean().nullable().optional(),
})

export const routineIdInputSchema = z.strictObject({ routineId: z.string().min(1) })

export const routineGetInputSchema = z.strictObject({
  routineId: z.string().min(1),
  projectId: z.string().min(1).optional(),
})

export const routineRemoveOutputSchema = z.strictObject({ removed: z.boolean() })

export const routineRunOutputSchema = z.strictObject({ sessionId: z.string().min(1) })

export const routineRunRowSchema = z.strictObject({
  runId: z.string().min(1),
  scheduledFor: z.string().min(1),
  outcome: routineRunOutcomeSchema,
  reason: z.string().nullable(),
  sessionId: z.string().nullable(),
  at: z.string().min(1),
})

export const routineRunsInputSchema = z.strictObject({
  routineId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
})

export const routineRunsOutputSchema = z.strictObject({ runs: z.array(routineRunRowSchema) })

export type Routine = z.infer<typeof routineSchema>
export type RoutineListInput = z.infer<typeof routineListInputSchema>
export type RoutineListOutput = z.infer<typeof routineListOutputSchema>
export type RoutineCreateInput = z.infer<typeof routineCreateInputSchema>
export type RoutineUpdateInput = z.infer<typeof routineUpdateInputSchema>
export type RoutineIdInput = z.infer<typeof routineIdInputSchema>
export type RoutineGetInput = z.infer<typeof routineGetInputSchema>
export type RoutineRemoveOutput = z.infer<typeof routineRemoveOutputSchema>
export type RoutineRunOutput = z.infer<typeof routineRunOutputSchema>
export type RoutineRunRow = z.infer<typeof routineRunRowSchema>
export type RoutineRunsInput = z.infer<typeof routineRunsInputSchema>
export type RoutineRunsOutput = z.infer<typeof routineRunsOutputSchema>

export const accountMeOutputSchema = z.strictObject({
  userId: z.string(),
  email: z.string(),
  active: z.boolean(),
})

export type AccountMeOutput = z.infer<typeof accountMeOutputSchema>
