import {
  callKindOf,
  classify,
  ECallKind,
  ECallState,
  formatElapsed,
  imageOf,
  inputOf,
  isMemoryTool,
  str,
  targetOf,
  type ToolCall,
} from '@dltech/atlas-client/transcript'
import type { MessageImage } from '@dltech/atlas-ui/ai/message'
import type { CodeQualityReviewedBody } from '@dltech/atlas-core'
import { EToolKind, EToolState } from '@dltech/atlas-ui/ai/tool'

import { editBodyOf, type EditBody } from './transcript-edit-body'

const OUTPUT_LIMIT = 4_000
export const FAILED_FALLBACK = 'The run failed.'

export enum EToolFamily {
  Agent = 'agent',
  Plan = 'plan',
  Memory = 'memory',
  Other = 'other',
}

export type ToolCallItem = {
  id: string
  kind: EToolKind
  state: EToolState
  label: string
  title?: string
  /** The server and tool an MCP call belongs to, when the row can draw them apart. */
  mcp?: { server: string; tool: string }
  family?: EToolFamily
  path?: string
  change?: EditBody
  image?: MessageImage
  at?: string
  settledAt?: string
  output?: string
  errorText?: string
  elapsed?: string
  qualityReviews?: readonly CodeQualityReviewedBody[]
}

const TOOL_KIND_OF_CALL: Partial<Record<ECallKind, EToolKind>> = {
  [ECallKind.Shell]: EToolKind.Shell,
  [ECallKind.Read]: EToolKind.Read,
  [ECallKind.Search]: EToolKind.Search,
  [ECallKind.Edit]: EToolKind.Edit,
  [ECallKind.Web]: EToolKind.Web,
  [ECallKind.Skill]: EToolKind.Skill,
}

const FAMILY_OF_CALL: Partial<Record<ECallKind, EToolFamily>> = {
  [ECallKind.Agent]: EToolFamily.Agent,
  [ECallKind.Plan]: EToolFamily.Plan,
}

const toolKindOf = (name: string): EToolKind | undefined => TOOL_KIND_OF_CALL[callKindOf(name)]

const familyOf = (name: string): EToolFamily =>
  isMemoryTool(name) ? EToolFamily.Memory : (FAMILY_OF_CALL[callKindOf(name)] ?? EToolFamily.Other)

const TITLED_STATES: readonly EToolState[] = [EToolState.Done, EToolState.Error, EToolState.Denied]

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
  if (toolKindOf(call.name) !== EToolKind.Edit) return undefined
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
  const kind = toolKindOf(call.name)
  const classified = classify({ call, cwd: '' })
  const path = editPathOf(call)
  const change = kind === EToolKind.Edit ? editBodyOf({ call, state }) : undefined
  const image = pictureOf(call)
  return {
    id: call.callId,
    kind: kind ?? EToolKind.Shell,
    state,
    ...(kind === undefined ? { family: familyOf(call.name) } : {}),
    ...(classified.mcp === undefined ? {} : { mcp: classified.mcp }),
    ...(kind === undefined && TITLED_STATES.includes(state) ? { title: classified.line } : {}),
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
    ...(call.settledAt === null ? {} : { settledAt: call.settledAt }),
    ...(call.qualityReviews === undefined || call.qualityReviews.length === 0
      ? {}
      : { qualityReviews: call.qualityReviews }),
  }
}
