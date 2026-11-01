import {
  assembleTranscript,
  durableEntries,
  EEntryKind,
  EThinkingVisibility,
  type InFlightStep,
  type OperatorSaidEntry,
  type PrEventEntry,
  type RevealGate,
  type ToolCall,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'
import type { CallId, Event, SaidImage, SaidUpload } from '@dltech/atlas-core'

import {
  claimSpawn,
  reportItemsOf,
  spawnItemsOf,
  withInserted,
  type ReportItem,
  type SpawnItem,
} from './transcript-agents'
import { ENoticeTone, ETranscriptKind } from './transcript-kind'
import {
  noticeItemOf,
  prNoticeItemOf,
  type NoticeContext,
  type NoticeItem,
} from './transcript-notices'
import { toolCallItemOf, type ToolCallItem } from './transcript-tools'

export { ENoticeTone, ETranscriptKind }
export type { NoticeContext, NoticeItem }
export { EToolFamily, type ToolCallItem } from './transcript-tools'
export { EEditBody, type EditBody } from './transcript-edit-body'
export type { ReportItem, SpawnItem } from './transcript-agents'

type Timed = { at?: string | undefined }

export type TranscriptItem = Timed &
  (
    | {
        kind: ETranscriptKind.User
        id: string
        text: string
        images?: readonly SaidImage[]
        uploads?: readonly SaidUpload[]
      }
    | {
        kind: ETranscriptKind.Agent
        id: string
        text: string
        streaming: boolean
      }
    | {
        kind: ETranscriptKind.Thought
        id: string
        text: string
        streaming: boolean
        heldOpen: boolean
      }
    | { kind: ETranscriptKind.Tools; id: string; calls: ToolCallItem[] }
    | NoticeItem
  )

export type TranscriptRow = TranscriptItem | SpawnItem | ReportItem

export type ThreadTranscriptView = {
  items: TranscriptRow[]
  streaming: boolean
}

function userItemOf(entry: OperatorSaidEntry): TranscriptItem | null {
  const images = entry.images.length > 0 ? { images: entry.images } : {}
  const uploads = (entry.uploads ?? []).length > 0 ? { uploads: entry.uploads } : {}
  const attached = 'images' in images || 'uploads' in uploads
  if (!attached && entry.text.trim().length === 0) return null
  return {
    kind: ETranscriptKind.User,
    id: entry.key,
    text: entry.text,
    ...images,
    ...uploads,
  }
}

function textItemOf(entry: TranscriptEntry): TranscriptItem | null {
  switch (entry.kind) {
    case EEntryKind.OperatorSaid:
      return userItemOf(entry)
    case EEntryKind.ModelSaid:
      return entry.muted || entry.text.trim().length === 0
        ? null
        : {
            kind: ETranscriptKind.Agent,
            id: entry.key,
            text: entry.text,
            streaming: entry.streaming,
          }
    case EEntryKind.ModelThought:
      return entry.text.trim().length === 0
        ? null
        : {
            kind: ETranscriptKind.Thought,
            id: entry.key,
            text: entry.text,
            streaming: entry.streaming,
            heldOpen: entry.heldOpen,
          }
    default:
      return noticeItemOf(entry)
  }
}

type Segment = { calls: ToolCall[] } | { spawn: SpawnItem }

function segmentsOf(args: { calls: readonly ToolCall[]; pool: Map<string, SpawnItem> }): Segment[] {
  const segments: Segment[] = []
  for (const call of args.calls) {
    const spawn = claimSpawn({ call, pool: args.pool })
    const last = segments.at(-1)
    if (spawn !== undefined) segments.push({ spawn })
    else if (last !== undefined && 'calls' in last) last.calls.push(call)
    else segments.push({ calls: [call] })
  }
  return segments
}

function rowsOfTools(args: {
  key: string
  calls: readonly ToolCall[]
  pool: Map<string, SpawnItem>
}): TranscriptRow[] {
  const segments = segmentsOf(args)
  return segments.map((segment, index): TranscriptRow => {
    if ('spawn' in segment) return segment.spawn
    return {
      kind: ETranscriptKind.Tools,
      id: index === 0 ? args.key : `${args.key}#${index}`,
      calls: segment.calls.map(toolCallItemOf),
    }
  })
}

const eventIdOf = (key: string): string => key.split('#')[0] ?? key

function stamped(args: { row: TranscriptRow; at: string | undefined }): TranscriptRow {
  return args.at === undefined || args.row.at !== undefined
    ? args.row
    : { ...args.row, at: args.at }
}

function atOf(args: {
  row: TranscriptRow
  stamps: ReadonlyMap<string, string>
}): string | undefined {
  const { row } = args
  if (row.kind === ETranscriptKind.Tools) return row.calls[0]?.at
  return args.stamps.get(eventIdOf(row.id))
}

export type DurableTranscript = {
  entries: TranscriptEntry[]
  stamps: ReadonlyMap<string, string>
  spawns: SpawnItem[]
  reports: ReportItem[]
}

export const durableTranscriptOf = (args: { events: readonly Event[] }): DurableTranscript => ({
  entries: durableEntries({ events: args.events }),
  stamps: new Map(args.events.map((event) => [event.id as string, event.at])),
  spawns: spawnItemsOf(args.events),
  reports: [...reportItemsOf(args.events).values()],
})

function prRunAt(args: { entries: readonly TranscriptEntry[]; index: number }): PrEventEntry[] {
  const first = args.entries[args.index]
  if (first === undefined || first.kind !== EEntryKind.PrEvent) return []
  const run: PrEventEntry[] = [first]
  for (const next of args.entries.slice(args.index + 1)) {
    const sameChain =
      next.kind === EEntryKind.PrEvent &&
      next.repo === first.repo &&
      next.prNumber === first.prNumber
    if (!sameChain) break
    run.push(next)
  }
  return run
}

export function transcriptViewOf(args: {
  durable: DurableTranscript
  live: readonly InFlightStep[]
  outputs?: ReadonlyMap<CallId, string>
  reveal?: RevealGate | null
}): ThreadTranscriptView {
  const model = assembleTranscript({
    durable: args.durable.entries,
    live: args.live,
    outputs: args.outputs,
    thinking: EThinkingVisibility.Stream,
    ...(args.reveal === undefined ? {} : { reveal: args.reveal }),
  })
  const { stamps } = args.durable
  const pool = new Map(args.durable.spawns.map((spawn) => [spawn.agentId, spawn]))
  const rows: TranscriptRow[] = []
  let index = 0
  while (index < model.entries.length) {
    const entry = model.entries[index]
    if (entry === undefined) break
    const run = prRunAt({ entries: model.entries, index })
    index += Math.max(run.length, 1)
    const found =
      entry.kind === EEntryKind.ToolsRan
        ? rowsOfTools({ key: entry.key, calls: entry.run.calls, pool })
        : [run.length > 0 ? prNoticeItemOf(run) : textItemOf(entry)].flatMap((item) =>
            item === null ? [] : [item],
          )
    for (const row of found) rows.push(stamped({ row, at: atOf({ row, stamps }) }))
  }
  return {
    items: withInserted({
      items: rows,
      inserted: [...pool.values(), ...args.durable.reports],
    }),
    streaming: model.streaming,
  }
}

export const isTextStreaming = (items: readonly TranscriptRow[]): boolean =>
  items.some((item) => item.kind === ETranscriptKind.Agent && item.streaming)
