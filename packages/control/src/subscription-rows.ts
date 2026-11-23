import {
  INBOX_KIND_RECORD,
  inboxEventPayloadOf,
  toThreadId,
  type EventBody,
  type JsonValue,
} from '@dltech/atlas-core'
import type { SessionSubscription } from '@dltech/atlas-protocol'

import { postIn } from './inbox-ops'
import type { ControlSessionRow, ControlTx, SubscriptionRow, SubscriptionSubject } from './port'
import { repoFullNameOf } from './repo-name'

const GITHUB_PROVIDER_OF_KIND: Readonly<Record<string, string>> = {
  'pull-request': 'github.pull-request',
  'workflow-run': 'github.workflow-run',
}

const RUN_SELECTOR = /^#run:(\d+)$/
const WORKFLOW_SELECTOR = /^#workflow:(.+)@([^@]+)$/

export type SubscriptionLeaseInput = {
  repo: string
  subject: SubscriptionSubject
}

const canonicalRepoOf = (repoFullName: string): string => `github.com/${repoFullName}`

const legacyTargetOf = (row: SubscriptionRow): JsonValue => {
  const repo = canonicalRepoOf(row.repoFullName)
  if (row.kind === 'pull-request') return { repo, number: row.prNumber ?? 0 }
  const run = RUN_SELECTOR.exec(row.branch)
  if (run?.[1] !== undefined) return { kind: 'run', repo, runId: Number(run[1]) }
  const workflow = WORKFLOW_SELECTOR.exec(row.branch)
  if (workflow?.[1] !== undefined && workflow[2] !== undefined) {
    return { kind: 'selector', repo, workflow: workflow[1], branch: workflow[2] }
  }
  return { kind: 'workflow-run', repo, selector: row.branch }
}

const labelOf = (row: SubscriptionRow): string => {
  if (row.label !== '') return row.label
  if (row.kind === 'pull-request') return `${row.repoFullName}#${row.prNumber ?? 0}`
  return `${row.repoFullName}${row.branch}`
}

export const subscriptionOf = (row: SubscriptionRow): SessionSubscription => ({
  id: row.subscriptionId,
  threadId: row.threadId,
  provider: row.provider === '' ? (GITHUB_PROVIDER_OF_KIND[row.kind] ?? row.kind) : row.provider,
  target: row.target ?? legacyTargetOf(row),
  label: labelOf(row),
  events: [...row.events],
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
})

type SubscriptionRecordBody = Extract<
  EventBody,
  { type: 'subscription-created' } | { type: 'subscription-ended' }
>

const clientIdOf = (event: SubscriptionRecordBody): string => {
  if (event.type === 'subscription-ended') return `subscription-ended:${event.subscriptionId}`
  return `subscription-created:${event.subscriptionId}:${crypto.randomUUID()}`
}

export const recordOf = async (params: {
  tx: ControlTx
  session: ControlSessionRow
  threadId: string
  event: SubscriptionRecordBody
  at: string
}): Promise<void> => {
  await postIn({
    tx: params.tx,
    sessionId: params.session.sessionId,
    kind: INBOX_KIND_RECORD,
    payload: inboxEventPayloadOf({ event: params.event, clientId: clientIdOf(params.event) }),
    at: params.at,
    ...(params.threadId === params.session.mainThreadId
      ? {}
      : { threadId: toThreadId(params.threadId) }),
    wake: false,
  })
}

export const tracked = async (params: {
  tx: ControlTx
  session: ControlSessionRow
  lease: SubscriptionLeaseInput
  expiresAt: string | null
}): Promise<void> => {
  if (params.lease.subject.kind !== 'pull-request') return
  await params.tx.upsertTrackingTarget({
    userId: params.session.userId,
    kind: 'pull-request',
    repoFullName: repoFullNameOf(params.lease.repo),
    branch: '',
    prNumber: params.lease.subject.number,
    liveUntil: params.expiresAt,
  })
  await params.tx.insertSessionPullRequests([
    {
      sessionId: params.session.sessionId,
      repo: params.lease.repo,
      number: params.lease.subject.number,
    },
  ])
}
