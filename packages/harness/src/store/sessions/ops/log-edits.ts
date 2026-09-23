import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  EForkMode,
  stampDrafts,
  type ClockPort,
  type Event,
  type EventDraft,
  type EventEnvelope,
  type IdPort,
  type RunId,
  type ThreadId,
} from '@dltech/atlas-core'

import { contextIdentityOf } from '../../append-plan'
import { EUnreadableReason } from '../../decode-events'
import { dropTornTail, encodeEventLine } from '../lines'
import { newThreadMeta, readMetaSync, threadMetaSchema, writeMeta } from '../meta'
import { eventLogFile, threadMetaFile } from '../paths'
import { rebuildContextIndex, type SessionRegistry } from '../registry'

export function draftOf(event: Event): EventDraft {
  const { id, seq, threadId, runId, parentRunId, depth, at, ...draft } = event
  return draft
}

async function writeHead({
  clock,
  sessionDir,
  threadId,
  head,
  at,
}: {
  clock: ClockPort
  sessionDir: string
  threadId: ThreadId
  head: number
  at: string
}): Promise<void> {
  const metaFile = threadMetaFile({ sessionDir, threadId })
  const meta = readMetaSync({ file: metaFile, schema: threadMetaSchema }) ?? newThreadMeta({ id: threadId, at: clock.now() })
  await writeMeta({ file: metaFile, meta: { ...meta, head, updatedAt: at } })
}

export async function truncateThreadLog({
  registry,
  clock,
  sessionDir,
  threadId,
  toSeq,
}: {
  registry: SessionRegistry
  clock: ClockPort
  sessionDir: string
  threadId: ThreadId
  toSeq: number
}): Promise<void> {
  const log = await registry.readThreadLog({ sessionDir, threadId })
  const retained = log.events.filter((event) => event.seq <= toSeq)

  const file = eventLogFile({ sessionDir, threadId })
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const lines = retained
    .map((event) => `${encodeEventLine({ draft: draftOf(event), envelope: envelopeOf(event) })}\n`)
    .join('')
  await writeFile(tmp, lines)
  await rename(tmp, file)
  await registry.stampThreadLog({ sessionDir, threadId })

  log.events.length = 0
  log.events.push(...retained)
  log.unreadable = log.unreadable.filter((row) => row.seq <= toSeq)
  const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId }), schema: threadMetaSchema })
  const floor = meta?.forkMode === EForkMode.Reference ? (meta.forkSeq ?? 0) : 0
  log.head = Math.max(retained.at(-1)?.seq ?? 0, floor)
  rebuildContextIndex({ log })

  await writeHead({ clock, sessionDir, threadId, head: log.head, at: clock.now() })
}

export async function appendDrafts({
  registry,
  clock,
  ids,
  sessionDir,
  threadId,
  runId,
  drafts,
}: {
  registry: SessionRegistry
  clock: ClockPort
  ids: IdPort
  sessionDir: string
  threadId: ThreadId
  runId: RunId
  drafts: readonly EventDraft[]
}): Promise<Event[]> {
  if (drafts.length === 0) return []
  const log = await registry.refreshThreadLog({ sessionDir, threadId })
  const at = clock.now()
  const firstSeq = log.head + 1

  const prepared = drafts.map((draft, index) => {
    const envelope: EventEnvelope = {
      id: ids.nextEventId(),
      seq: firstSeq + index,
      threadId,
      runId,
      depth: 0,
      at,
    }
    return { draft, envelope }
  })

  const file = eventLogFile({ sessionDir, threadId })
  await mkdir(dirname(file), { recursive: true })
  if (await dropTornTail({ file })) {
    log.unreadable = log.unreadable.filter((row) => row.reason !== EUnreadableReason.TruncatedTail)
  }
  await appendFile(file, prepared.map((entry) => `${encodeEventLine(entry)}\n`).join(''), 'utf8')
  await registry.stampThreadLog({ sessionDir, threadId })

  const stamped = stampDrafts({
    drafts: prepared.map((entry) => entry.draft),
    envelopes: prepared.map((entry) => entry.envelope),
  })
  log.events.push(...stamped)
  log.head = firstSeq + stamped.length - 1
  for (const event of stamped) {
    const identity = contextIdentityOf(event)
    if (identity !== undefined) log.byContext.set(identity, event)
  }

  await writeHead({ clock, sessionDir, threadId, head: log.head, at })
  return stamped
}

function envelopeOf(event: Event): EventEnvelope {
  const envelope: EventEnvelope = {
    id: event.id,
    seq: event.seq,
    threadId: event.threadId,
    runId: event.runId,
    depth: event.depth,
    at: event.at,
    ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
  }
  return envelope
}
