import type { Attachment } from '@dltech/atlas-core'
import {
  EEntryKind,
  formatElapsed,
  type ToolRun,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'

export enum ERowKind {
  Message = 'message',
  Work = 'work',
  Notice = 'notice',
}

export enum EMessageAuthor {
  You = 'you',
  Atlas = 'atlas',
}

export enum ENoticeTone {
  Ok = 'ok',
  Failed = 'failed',
  Attention = 'attention',
  Quiet = 'quiet',
}

export type MessageRow = {
  kind: ERowKind.Message
  id: string
  author: EMessageAuthor
  at: string | undefined
  text: string
  streaming: boolean
  steer: boolean
  attachments: readonly Attachment[]
}
export type ThoughtItem = {
  kind: EEntryKind.ModelThought
  id: string
  text: string
  streaming: boolean
}

export type ToolsItem = {
  kind: EEntryKind.ToolsRan
  id: string
  run: ToolRun
  streaming: boolean
}

export type WorkItem = ThoughtItem | ToolsItem

export type WorkRow = {
  kind: ERowKind.Work
  id: string
  items: readonly WorkItem[]
  stepCount: number
  running: boolean
  elapsed: string
  startedAt: string | undefined
  endedAt: string | undefined
}

export type NoticeRow = {
  kind: ERowKind.Notice
  id: string
  at: string | undefined
  title: string
  body: string
  tone: ENoticeTone
}

export type ThreadRow = MessageRow | WorkRow | NoticeRow

const NOTICED_PREFIX = 'Atlas noticed — '

const stampOf = (value: string | undefined | null): number | undefined => {
  if (value === undefined || value === null) return undefined
  const stamp = Date.parse(value)
  return Number.isNaN(stamp) ? undefined : stamp
}

const latestStamp = (values: ReadonlyArray<string | undefined | null>): string | undefined =>
  values.reduce<string | undefined>((latest, value) => {
    if (value === undefined || value === null) return latest
    if (latest === undefined) return value
    const current = stampOf(latest)
    const candidate = stampOf(value)
    if (current === undefined || candidate === undefined) return latest
    return candidate > current ? value : latest
  }, undefined)

const stepsIn = (item: WorkItem): number =>
  item.kind === EEntryKind.ModelThought ? 1 : item.run.calls.length

type Building = {
  items: WorkItem[]
  startedAt: string | undefined
  endedAt: string | undefined
  durationMs: number | undefined
  running: boolean
}

const noticeOf = (args: {
  id: string
  at: string | undefined
  title: string
  body?: string
  tone: ENoticeTone
}): NoticeRow => ({
  kind: ERowKind.Notice,
  id: args.id,
  at: args.at,
  title: args.title,
  body: args.body ?? '',
  tone: args.tone,
})

const toneOfFailed = (failed: boolean): ENoticeTone =>
  failed ? ENoticeTone.Failed : ENoticeTone.Ok

function noticeFieldsOf(entry: TranscriptEntry): {
  title: string
  body: string
  tone: ENoticeTone
} | null {
  switch (entry.kind) {
    case EEntryKind.SystemNotice:
      return {
        title: `${NOTICED_PREFIX}${entry.text}`,
        body: entry.content,
        tone: ENoticeTone.Quiet,
      }
    case EEntryKind.SystemContext:
      return { title: entry.text, body: '', tone: ENoticeTone.Quiet }
    case EEntryKind.AgentRestarted:
    case EEntryKind.OperatorInput:
    case EEntryKind.HistoryCompacted:
    case EEntryKind.TldrWritten:
      return { title: entry.text, body: '', tone: ENoticeTone.Quiet }
    case EEntryKind.SandboxNotice: {
      const [title = '', ...rest] = entry.text.split('\n\n')
      return {
        title,
        body: rest.join('\n\n'),
        tone: entry.failed ? ENoticeTone.Attention : ENoticeTone.Quiet,
      }
    }
    case EEntryKind.BackgroundShellEnded:
    case EEntryKind.ServiceEnded:
      return { title: entry.text, body: entry.output, tone: toneOfFailed(entry.failed) }
    case EEntryKind.BackgroundShellAwaitingInput:
      return { title: entry.text, body: entry.output, tone: ENoticeTone.Failed }
    case EEntryKind.BackgroundShellMatched:
    case EEntryKind.BackgroundShellStillRunning:
      return { title: entry.text, body: entry.output, tone: ENoticeTone.Ok }
    case EEntryKind.AgentEnded:
      return { title: entry.text, body: entry.report, tone: toneOfFailed(entry.failed) }
    case EEntryKind.AgentReported:
      return { title: entry.text, body: entry.report, tone: ENoticeTone.Ok }
    case EEntryKind.Rotated:
      return { title: entry.text, body: '', tone: ENoticeTone.Quiet }
    case EEntryKind.PrEvent:
      return { title: entry.text, body: entry.body, tone: toneOfFailed(entry.failed) }
    default:
      return null
  }
}

const elapsedOf = (args: { building: Building; now: number }): string => {
  if (args.building.durationMs !== undefined) return formatElapsed(args.building.durationMs)
  const startedAt = stampOf(args.building.startedAt)
  if (startedAt === undefined) return ''
  const endedAt = args.building.running ? args.now : (stampOf(args.building.endedAt) ?? args.now)
  return formatElapsed(Math.max(0, endedAt - startedAt))
}

const workRowOf = (args: { building: Building; now: number }): WorkRow => ({
  kind: ERowKind.Work,
  id: `work:${args.building.items[0]?.id ?? 'empty'}`,
  items: args.building.items,
  stepCount: args.building.items.reduce((total, item) => total + stepsIn(item), 0),
  running: args.building.running,
  elapsed: elapsedOf({ building: args.building, now: args.now }),
  startedAt: args.building.startedAt,
  endedAt: args.building.endedAt,
})

export function rowsOf(args: {
  entries: readonly TranscriptEntry[]
  working: boolean
  now: number
  atOf?: (id: string) => string | undefined
}): ThreadRow[] {
  const atOf = args.atOf ?? (() => undefined)
  const rows: ThreadRow[] = []
  let building: Building | null = null

  const flush = () => {
    if (building === null) return
    if (building.items.length > 0) rows.push(workRowOf({ building, now: args.now }))
    building = null
  }

  const endTurn = (entry: { endedAt: string; durationMs: number }) => {
    const work = building
    if (work === null) return
    work.endedAt = entry.endedAt
    work.durationMs = entry.durationMs
    work.running = false
    flush()
  }

  const open = (): Building => {
    if (building !== null) return building
    building = {
      items: [],
      startedAt: undefined,
      endedAt: undefined,
      durationMs: undefined,
      running: false,
    }
    return building
  }

  for (const entry of args.entries) {
    switch (entry.kind) {
      case EEntryKind.OperatorSaid:
        flush()
        if (entry.text.trim().length === 0 && entry.attachments.length === 0) continue
        rows.push({
          kind: ERowKind.Message,
          id: entry.key,
          at: atOf(entry.key),
          author: EMessageAuthor.You,
          text: entry.text,
          streaming: false,
          steer: entry.steer,
          attachments: entry.attachments,
        })
        continue
      case EEntryKind.ModelSaid:
        flush()
        if (entry.muted || entry.text.trim().length === 0) continue
        rows.push({
          kind: ERowKind.Message,
          id: entry.key,
          at: atOf(entry.key),
          author: EMessageAuthor.Atlas,
          text: entry.text,
          streaming: entry.streaming,
          steer: false,
          attachments: [],
        })
        continue
      case EEntryKind.ModelThought: {
        if (entry.text.trim().length === 0) continue
        const work = open()
        work.items.push({
          kind: EEntryKind.ModelThought,
          id: entry.key,
          text: entry.text,
          streaming: entry.streaming,
        })
        if (entry.streaming) work.running = true
        continue
      }
      case EEntryKind.ToolsRan: {
        const work = open()
        work.items.push({
          kind: EEntryKind.ToolsRan,
          id: entry.key,
          run: entry.run,
          streaming: entry.streaming,
        })
        work.startedAt ??= latestStamp(entry.run.calls.map((call) => call.at))
        work.endedAt = latestStamp([work.endedAt, ...entry.run.calls.map((call) => call.settledAt)])
        if (entry.streaming) work.running = true
        continue
      }
      case EEntryKind.TurnEnded:
        endTurn(entry)
        continue
      default: {
        const fields = noticeFieldsOf(entry)
        if (fields === null) continue
        flush()
        rows.push(noticeOf({ id: entry.key, at: atOf(entry.key), ...fields }))
        continue
      }
    }
  }

  flush()
  return rows
}

export const startedAtOf = (row: WorkRow): number | undefined => stampOf(row.startedAt)

export type { ToolRun }
