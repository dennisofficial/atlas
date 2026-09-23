import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  pullRequestsOf,
  stampDrafts,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type EventId,
  type IdPort,
  type LinkedPullRequest,
  type ThreadId,
} from '@dltech/atlas-core'

import { contextIdentityOf } from '../append-plan'
import { planSegments, type Segment } from './compose'
import { encodeEventLine } from './lines'
import { eventLogFile, threadsDirectory } from './paths'
import { rebuildContextIndex, type SessionRegistry } from './registry'

export type ThreadWorktree = { path: string; branch: string }

export type ThreadPlaces = {
  worktree: ThreadWorktree | null
  pullRequests: LinkedPullRequest[]
}

const WORKTREE_EVENT_TYPES = new Set(['worktree-entered', 'worktree-exited', 'directory-changed'])

export async function threadPlaces(args: {
  home: string
  registry: SessionRegistry
  sessionDir: string
  threadId: ThreadId
  upTo?: number | undefined
}): Promise<ThreadPlaces> {
  const segments = planSegments({
    home: args.home,
    sessionDir: args.sessionDir,
    threadId: args.threadId,
    upTo: args.upTo,
  })
  const events = await readSegments({
    registry: args.registry,
    ownDir: args.sessionDir,
    ownThread: args.threadId,
    segments,
  })
  return {
    worktree: worktreeFrom({ segmentEvents: events }),
    pullRequests: linkedFrom({ segmentEvents: events }),
  }
}

async function readSegments({
  registry,
  ownDir,
  ownThread,
  segments,
}: {
  registry: SessionRegistry
  ownDir: string
  ownThread: ThreadId
  segments: readonly Segment[]
}): Promise<Event[][]> {
  const read: Event[][] = []
  for (const segment of segments) {
    const all =
      segment.threadId === ownThread && segment.sessionDir === ownDir
        ? (await registry.readThreadLog({ sessionDir: segment.sessionDir, threadId: segment.threadId })).events
        : await registry.readParentEvents({
            file: eventLogFile({ sessionDir: segment.sessionDir, threadId: segment.threadId }),
          })
    read.push(all.filter((event) => segment.upTo === undefined || event.seq <= segment.upTo))
  }
  return read
}

function worktreeFrom({ segmentEvents }: { segmentEvents: readonly Event[][] }): ThreadWorktree | null {
  for (let index = segmentEvents.length - 1; index >= 0; index -= 1) {
    const moves = (segmentEvents[index] ?? []).filter((event) => WORKTREE_EVENT_TYPES.has(event.type))
    const latest = moves.at(-1)
    if (latest === undefined) continue
    if (latest.type !== 'worktree-entered') return null
    return { path: latest.path, branch: latest.branch }
  }
  return null
}

function linkedFrom({ segmentEvents }: { segmentEvents: readonly Event[][] }): LinkedPullRequest[] {
  for (let index = segmentEvents.length - 1; index >= 0; index -= 1) {
    const linked = (segmentEvents[index] ?? []).filter((event) => event.type === 'pull-request-linked')
    if (linked.length > 0) return [...pullRequestsOf(linked)]
  }
  return []
}

export function draftOf(event: Event): EventDraft {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...draft } = event
  return draft
}

function envelopeOf(event: Event, id: EventId): EventEnvelope {
  return {
    id,
    seq: event.seq,
    threadId: event.threadId,
    runId: event.runId,
    ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
    depth: event.depth,
    at: event.at,
  }
}

export async function appendStampedEvent({
  registry,
  sessionDir,
  event,
}: {
  registry: SessionRegistry
  sessionDir: string
  event: Event
}): Promise<void> {
  const file = eventLogFile({ sessionDir, threadId: event.threadId })
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, `${encodeEventLine({ draft: draftOf(event), envelope: envelopeOf(event, event.id) })}\n`, 'utf8')
  await registry.stampThreadLog({ sessionDir, threadId: event.threadId })
  const log = await registry.readThreadLog({ sessionDir, threadId: event.threadId })
  log.events.push(event)
  log.head = event.seq
  const identity = contextIdentityOf(event)
  if (identity !== undefined) log.byContext.set(identity, event)
}

export async function rewriteThreadLog({
  registry,
  ids,
  sessionDir,
  threadId,
  events,
}: {
  registry: SessionRegistry
  ids: IdPort
  sessionDir: string
  threadId: ThreadId
  events: readonly Event[]
}): Promise<void> {
  const restamped = events.map((event) => ({
    draft: draftOf(event),
    envelope: { ...envelopeOf(event, ids.nextEventId()), threadId },
  }))
  const file = eventLogFile({ sessionDir, threadId })
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(threadsDirectory({ sessionDir }), `.rewrite.${process.pid}.tmp`)
  await writeFile(tmp, restamped.map((entry) => `${encodeEventLine(entry)}\n`).join(''))
  await rename(tmp, file)
  await registry.stampThreadLog({ sessionDir, threadId })
  const log = await registry.readThreadLog({ sessionDir, threadId })
  const stamped = stampDrafts({
    drafts: restamped.map((entry) => entry.draft),
    envelopes: restamped.map((entry) => entry.envelope),
  })
  log.events.length = 0
  log.events.push(...stamped)
  log.head = stamped.at(-1)?.seq ?? 0
  rebuildContextIndex({ log })
  registry.invalidateParent({ file })
}
