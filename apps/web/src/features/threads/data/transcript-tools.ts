import {
  classify,
  ECallState,
  formatElapsed,
  imageOf,
  inputOf,
  str,
  targetOf,
  type ToolCall,
} from '@dltech/atlas-client/transcript'
import type { MessageImage } from '@dltech/atlas-ui/ai/message'
import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { editBodyOf, type EditBody } from './transcript-edit-body'

const OUTPUT_LIMIT = 4_000
export const FAILED_FALLBACK = 'The run failed.'

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
  path?: string
  change?: EditBody
  image?: MessageImage
  at?: string
  output?: string
  errorText?: string
  elapsed?: string
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

export function editPathOf(call: ToolCall): string | undefined {
  if (KIND_OF_TOOL[call.name] !== EToolKind.Edit) return undefined
  const input = inputOf(call)
  return str(input.path) ?? str(input.file_path) ?? str(input.filePath)
}

const fileNameOf = (path: string): string => path.split('/').at(-1) || path

function pictureOf(call: ToolCall): MessageImage | undefined {
  const read = imageOf(call)
  if (call.image === undefined || read === null) return undefined
  return {
    id: `${call.callId}#image`,
    src: `data:${call.image.mediaType};base64,${call.image.data}`,
    alt: fileNameOf(read.path),
  }
}

export function toolCallItemOf(call: ToolCall): ToolCallItem {
  const state = STATE_OF_CALL[call.state]
  const note = call.note === null ? undefined : clipped(call.note)
  const elapsed = elapsedOf(call)
  const kind = KIND_OF_TOOL[call.name]
  const path = editPathOf(call)
  const change = kind === EToolKind.Edit ? editBodyOf({ call, state }) : undefined
  const image = pictureOf(call)
  return {
    id: call.callId,
    kind: kind ?? EToolKind.Shell,
    state,
    ...(kind === undefined ? { family: familyOf(call.name) } : {}),
    ...(kind === undefined && TITLED_STATES.includes(state)
      ? { title: classify({ call, cwd: '' }).line }
      : {}),
    label: targetOf({ call, cwd: '' }) ?? str(inputOf(call).url) ?? call.name,
    ...(path === undefined ? {} : { path }),
    ...(change === undefined ? {} : { change }),
    ...(image === undefined ? {} : { image }),
    ...(state === EToolState.Done && clipped(call.modelText) !== undefined
      ? { output: clipped(call.modelText) }
      : {}),
    ...(state === EToolState.Denied && note !== undefined ? { output: note } : {}),
    ...(state === EToolState.Error ? { errorText: note ?? FAILED_FALLBACK } : {}),
    ...(elapsed === undefined ? {} : { elapsed }),
    ...(call.at === null ? {} : { at: call.at }),
  }
}
