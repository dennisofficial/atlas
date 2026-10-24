import {
  classify,
  deriveTranscript,
  ECallState,
  EEntryKind,
  formatElapsed,
  inputOf,
  str,
  targetOf,
  type Clock,
  type ToolCall,
  type TranscriptEntry,
} from '@dltech/atlas-client/transcript'
import type { StepSignal } from '@dltech/atlas-client/channel'
import type { CallId, Event } from '@dltech/atlas-core'
import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

const OUTPUT_LIMIT = 4_000
const FAILED_FALLBACK = 'The run failed.'

export enum ETranscriptKind {
  User = 'user',
  Agent = 'agent',
  Thought = 'thought',
  Tools = 'tools',
}

export enum EToolFamily {
  Agent = 'agent',
  Plan = 'plan',
  Other = 'other',
}

export type ToolCallItem = {
  id: string
  kind: EToolKind
  state: EToolState
  label: string
  title?: string
  family?: EToolFamily
  at?: string
  output?: string
  errorText?: string
  elapsed?: string
}

type Timed = { at?: string | undefined }

export type TranscriptItem = Timed &
  (
    | { kind: ETranscriptKind.User; id: string; text: string }
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
      }
    | { kind: ETranscriptKind.Tools; id: string; calls: ToolCallItem[] }
  )

export type ThreadTranscriptView = {
  items: TranscriptItem[]
  streaming: boolean
  failure: string | null
}

const KIND_OF_TOOL: Record<string, EToolKind> = {
  read: EToolKind.Read,
  read_image: EToolKind.Read,
  grep: EToolKind.Search,
  glob: EToolKind.Search,
  edit: EToolKind.Edit,
  multi_edit: EToolKind.Edit,
  write: EToolKind.Edit,
  web_fetch: EToolKind.Web,
  web_search: EToolKind.Web,
  skill: EToolKind.Skill,
  bash: EToolKind.Shell,
}

const TITLED_STATES: readonly EToolState[] = [EToolState.Done, EToolState.Error, EToolState.Denied]

const AGENT_TOOL_PREFIX = 'agent_'
const PLAN_TOOL = 'task_write'

function familyOf(name: string): EToolFamily {
  if (name.startsWith(AGENT_TOOL_PREFIX)) return EToolFamily.Agent
  if (name === PLAN_TOOL) return EToolFamily.Plan
  return EToolFamily.Other
}

const STATE_OF_CALL: Record<ECallState, EToolState> = {
  [ECallState.Pending]: EToolState.Running,
  [ECallState.AwaitingApproval]: EToolState.AwaitingApproval,
  [ECallState.Ok]: EToolState.Done,
  [ECallState.Failed]: EToolState.Error,
  [ECallState.Denied]: EToolState.Denied,
}

const clipped = (text: string): string | undefined => {
  if (text.length === 0) return undefined
  return text.length <= OUTPUT_LIMIT ? text : `…${text.slice(-OUTPUT_LIMIT)}`
}

function elapsedOf(call: ToolCall): string | undefined {
  if (call.at === null || call.settledAt === null) return undefined
  const span = Date.parse(call.settledAt) - Date.parse(call.at)
  return Number.isNaN(span) ? undefined : formatElapsed(Math.max(0, span))
}

function toolCallItemOf(call: ToolCall): ToolCallItem {
  const state = STATE_OF_CALL[call.state]
  const note = call.note === null ? undefined : clipped(call.note)
  const elapsed = elapsedOf(call)
  const kind = KIND_OF_TOOL[call.name]
  return {
    id: call.callId,
    kind: kind ?? EToolKind.Shell,
    state,
    ...(kind === undefined ? { family: familyOf(call.name) } : {}),
    ...(kind === undefined && TITLED_STATES.includes(state)
      ? { title: classify({ call, cwd: '' }).line }
      : {}),
    label: targetOf({ call, cwd: '' }) ?? str(inputOf(call).url) ?? call.name,
    ...(state === EToolState.Done && clipped(call.modelText) !== undefined
      ? { output: clipped(call.modelText) }
      : {}),
    ...(state === EToolState.Denied && note !== undefined ? { output: note } : {}),
    ...(state === EToolState.Error ? { errorText: note ?? FAILED_FALLBACK } : {}),
    ...(elapsed === undefined ? {} : { elapsed }),
    ...(call.at === null ? {} : { at: call.at }),
  }
}

function itemOf(entry: TranscriptEntry): TranscriptItem | null {
  switch (entry.kind) {
    case EEntryKind.OperatorSaid:
      return entry.text.trim().length === 0
        ? null
        : { kind: ETranscriptKind.User, id: entry.key, text: entry.text }
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
          }
    case EEntryKind.ToolsRan:
      return {
        kind: ETranscriptKind.Tools,
        id: entry.key,
        calls: entry.run.calls.map(toolCallItemOf),
      }
    default:
      return null
  }
}

const eventIdOf = (key: string): string => key.split('#')[0] ?? key

function stamped(args: { item: TranscriptItem; at: string | undefined }): TranscriptItem {
  return args.at === undefined ? args.item : { ...args.item, at: args.at }
}

function atOf(args: {
  item: TranscriptItem
  stamps: ReadonlyMap<string, string>
}): string | undefined {
  const { item } = args
  if (item.kind === ETranscriptKind.Tools) return item.calls[0]?.at
  return args.stamps.get(eventIdOf(item.id))
}

export function transcriptViewOf(args: {
  events: readonly Event[]
  signals: readonly StepSignal[]
  outputs?: ReadonlyMap<CallId, string>
  now?: Clock
}): ThreadTranscriptView {
  const model = deriveTranscript({
    events: args.events,
    signals: args.signals,
    outputs: args.outputs,
    now: args.now ?? (() => new Date()),
  })
  const stamps = new Map(args.events.map((event) => [event.id as string, event.at]))
  return {
    items: model.entries.flatMap((entry) => {
      const item = itemOf(entry)
      if (item === null) return []
      return [stamped({ item, at: atOf({ item, stamps }) })]
    }),
    streaming: model.streaming,
    failure: model.failure === null ? null : (model.failure.message ?? FAILED_FALLBACK),
  }
}

export const isTextStreaming = (items: readonly TranscriptItem[]): boolean =>
  items.some((item) => item.kind === ETranscriptKind.Agent && item.streaming)
