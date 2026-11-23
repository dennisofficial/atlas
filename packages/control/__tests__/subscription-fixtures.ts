import {
  ESubscriptionActor,
  INBOX_KIND_RECORD,
  inboxEventOf,
  type EventBody,
} from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing/memory'

export const NOW = '2026-11-22T12:00:00.000Z'
export const SESSION = 'session-1'
export const OTHER_SESSION = 'session-2'
export const MAIN = 'thread-main'
export const CHILD = 'thread-child'
export const REPO = 'github.com/acme/atlas'
export const TTL_LATER = '2026-11-23T12:00:00.000Z'

export type SubscriptionRecordBody = Extract<
  EventBody,
  { type: 'subscription-created' } | { type: 'subscription-ended' }
>

export type Lease = {
  repo: string
  subject: { kind: 'pull-request'; number: number } | { kind: 'workflow-run'; selector: string }
}

export const pullRequestLease = (number: number): Lease => ({
  repo: REPO,
  subject: { kind: 'pull-request', number },
})

export const setup = async () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  const plane = new ControlPlane({ store, clock: () => NOW })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-a',
    projectId: 'project-a',
    mainThreadId: MAIN,
  })
  await plane.createSession({
    sessionId: OTHER_SESSION,
    userId: 'user-b',
    projectId: 'project-b',
    mainThreadId: 'thread-other',
  })
  return { store, plane }
}

export const subscribe = async (args: {
  plane: ControlPlane
  number?: number
  events?: readonly string[]
  expiresAt?: string | undefined
  threadId?: string
  sessionId?: string
}) =>
  await args.plane.subscribe({
    sessionId: args.sessionId ?? SESSION,
    threadId: args.threadId ?? MAIN,
    provider: 'github.pull-request',
    target: { repo: REPO, number: args.number ?? 7 },
    label: `acme/atlas#${args.number ?? 7}`,
    events: args.events ?? [],
    ...(args.expiresAt === undefined ? {} : { expiresAt: args.expiresAt }),
    lease: pullRequestLease(args.number ?? 7),
    by: ESubscriptionActor.Agent,
  })

export const recordsOf = async (args: {
  plane: ControlPlane
  threadId?: string | undefined
}): Promise<readonly SubscriptionRecordBody[]> => {
  const entries = await args.plane.readInbox({
    sessionId: SESSION,
    afterId: 0,
    limit: 50,
    ...(args.threadId === undefined ? {} : { forThread: args.threadId as never }),
  })
  return entries
    .filter((entry) => entry.kind === INBOX_KIND_RECORD)
    .map((entry) => {
      const read = inboxEventOf(entry.payload)
      if (!read.ok) throw new Error(read.reason)
      return read.event as SubscriptionRecordBody
    })
}

export const eventsOf = (records: readonly SubscriptionRecordBody[]): readonly string[][] =>
  records.map((record) =>
    record.type === 'subscription-created' ? [...(record.events ?? [])] : [],
  )
