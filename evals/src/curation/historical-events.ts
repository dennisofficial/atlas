import { posix } from 'node:path'

import { EHistoricalTool } from './historical-types'

export type HistoricalEnvelope = {
  index: number
  seq: number
  threadId: string
  runId: string
  at: string
  type: string
  body: Record<string, unknown>
}

export enum EToolClass {
  File = 'file',
  ReadOnly = 'read_only',
  Barrier = 'barrier',
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== ''

function bodyOf({ raw, type }: { raw: Record<string, unknown>; type: string }): Record<string, unknown> | null {
  if (!('body' in raw)) return raw
  const inner = raw['body']
  if (!isRecord(inner) || inner['type'] !== type) return null
  return inner
}

export function parseEnvelope({ raw, index }: { raw: unknown; index: number }): HistoricalEnvelope | null {
  if (!isRecord(raw)) return null
  const { id, seq, threadId, runId, at, type } = raw
  if (!nonEmptyString(id) || !nonEmptyString(threadId) || !nonEmptyString(runId)) return null
  if (!nonEmptyString(at) || !nonEmptyString(type)) return null
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null
  const body = bodyOf({ raw, type })
  return body === null ? null : { index, seq, threadId, runId, at, type, body }
}

export const callIdOf = (body: Record<string, unknown>): string | null =>
  nonEmptyString(body['callId']) ? body['callId'] : null

export const nameOf = (body: Record<string, unknown>): string | null =>
  nonEmptyString(body['name']) ? body['name'] : null

const FILE_TOOLS: ReadonlyMap<string, EHistoricalTool> = new Map([
  ['write', EHistoricalTool.Write],
  ['edit', EHistoricalTool.Edit],
  ['multi_edit', EHistoricalTool.MultiEdit],
])

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'read',
  'glob',
  'grep',
  'web_fetch',
  'web_search',
  'task_write',
  'worktree_list',
  'shell_list',
  'service_list',
  'agent_list',
])

const BENIGN_EVENTS: ReadonlySet<string> = new Set([
  'user-said',
  'assistant-said',
  'approval-requested',
  'approval-answered',
  'context-loaded',
  'nudge',
  'code-quality-reviewed',
  'loop-watch-verdict',
  'classifier-judged',
  'tldr-written',
  'permission-granted',
  'permission-revoked',
  'operator-input-requested',
  'operator-input-resolved',
  'pull-request-linked',
])

const BARRIER_EVENTS: ReadonlySet<string> = new Set([
  'worktree-entered',
  'worktree-exited',
  'location-changed',
  'parked',
  'directory-changed',
  'service-started',
  'service-ended',
  'agent-spawned',
  'agent-ended',
  'agent-restarted',
  'agent-reported',
  'history-compacted',
  'background-shell-started',
  'background-shell-ended',
  'background-shell-matched',
  'background-shell-still-running',
  'background-shell-awaiting-input',
])

export const isBarrierEvent = ({ type }: { type: string }): boolean => BARRIER_EVENTS.has(type)

export const toolOf = (name: string): EHistoricalTool | null => FILE_TOOLS.get(name) ?? null

export function classifyTool({ name }: { name: string }): EToolClass {
  if (FILE_TOOLS.has(name)) return EToolClass.File
  if (READ_ONLY_TOOLS.has(name)) return EToolClass.ReadOnly
  return EToolClass.Barrier
}

export const isBenignEvent = ({ type }: { type: string }): boolean => BENIGN_EVENTS.has(type)

const LABEL = /^[a-z0-9_-]{1,64}$/

export const labelOf = ({ value }: { value: string }): string => (LABEL.test(value) ? value : 'unrecognised')

export type ResolvedInput =
  | { ok: true; path: string; content: string | null }
  | { ok: false; unresolvedPath: boolean }

function resolvedPath({ raw }: { raw: unknown }): string | null {
  if (!nonEmptyString(raw)) return null
  if (!raw.startsWith('/') || raw.includes('$') || raw.includes('\0')) return null
  return posix.resolve(raw)
}

export function resolveFileInput({ tool, input }: { tool: EHistoricalTool; input: unknown }): ResolvedInput {
  if (!isRecord(input)) return { ok: false, unresolvedPath: false }
  const path = resolvedPath({ raw: input['path'] })
  if (path === null) return { ok: false, unresolvedPath: true }
  if (tool === EHistoricalTool.Write) {
    const content = input['content']
    return typeof content === 'string' ? { ok: true, path, content } : { ok: false, unresolvedPath: false }
  }
  if (tool === EHistoricalTool.Edit) {
    const valid = typeof input['oldString'] === 'string' && typeof input['newString'] === 'string'
    return valid ? { ok: true, path, content: null } : { ok: false, unresolvedPath: false }
  }
  const edits = input['edits']
  const valid = Array.isArray(edits) && edits.length > 0 && edits.every(isRecord)
  return valid ? { ok: true, path, content: null } : { ok: false, unresolvedPath: false }
}

export type WriteOutput = { path: string; created: boolean; bytes: number }
export type DiffOutput = { path: string; diff: string }

export function parseWriteOutput({ output }: { output: unknown }): WriteOutput | null {
  if (!isRecord(output)) return null
  const { path, created, bytes } = output
  if (typeof path !== 'string' || typeof created !== 'boolean') return null
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) return null
  return { path, created, bytes }
}

export function parseDiffOutput({ output }: { output: unknown }): DiffOutput | null {
  if (!isRecord(output)) return null
  const { path, diff } = output
  return typeof path === 'string' && typeof diff === 'string' ? { path, diff } : null
}
