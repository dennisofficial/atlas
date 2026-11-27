import type { Attachment } from '@dltech/atlas-core'
import {
  EEntryKind,
  eventIdOfEntryKey,
  formatElapsed,
  type ToolRun,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'

import { ENoticeTone, noticeFieldsOf } from './notice-fields'
import { picturesIn, type ToolPictureView } from './tool-pictures'

export { ENoticeTone } from './notice-fields'

export enum ERowKind {
  Message = 'message',
  Work = 'work',
  Notice = 'notice',
  Images = 'images',
}

export enum EMessageAuthor {
  You = 'you',
  Atlas = 'atlas',
}

export type CommandRow = { text: string; name: string }

export type MessageRow = {
  kind: ERowKind.Message
  id: string
  author: EMessageAuthor
  at: string | undefined
  text: string
  streaming: boolean
  steer: boolean
  staged?: boolean
  attachments: readonly Attachment[]
  command?: CommandRow | undefined
  sender?: string
  senderSessionId?: string | null
}

export type SessionNameOf = (sessionId: string) => string | undefined

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

export type ImagesRow = {
  kind: ERowKind.Images
  id: string
  images: readonly ToolPictureView[]
}

export type ThreadRow = MessageRow | WorkRow | NoticeRow | ImagesRow

export const senderLabelOf = (args: {
  row: MessageRow
  sessionNameOf?: SessionNameOf | undefined
}): string | undefined => {
  const senderSessionId = args.row.senderSessionId
  if (senderSessionId === undefined) return undefined
  if (senderSessionId === null) return `From ${args.row.sender ?? 'another session'}`
  const name = args.sessionNameOf?.(senderSessionId)?.trim()
  return `From ${name === undefined || name.length === 0 ? 'another session' : name}`
}

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
  const atOfEvent = args.atOf ?? (() => undefined)
  const atOf = (key: string) => atOfEvent(eventIdOfEntryKey(key))
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
          ...(entry.command === undefined
            ? {}
            : { command: { text: entry.command.text, name: entry.command.name } }),
        })
        continue
      case EEntryKind.AgentSaid:
        flush()
        if (entry.text.trim().length === 0) continue
        rows.push({
          kind: ERowKind.Message,
          id: entry.key,
          at: atOf(entry.key),
          author: EMessageAuthor.Atlas,
          text: entry.text,
          streaming: false,
          steer: false,
          attachments: [],
          sender: entry.sender,
          senderSessionId: entry.senderSessionId,
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
        const images = picturesIn(entry.run)
        if (images.length === 0) continue
        flush()
        rows.push({ kind: ERowKind.Images, id: `images:${entry.key}`, images })
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
