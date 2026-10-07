import { EExecutionLocation, EHarnessPlacement, EToolEnvironment } from '@dltech/atlas-core'

import {
  EVENTS_FILE_SUFFIX,
  LEDGER_FILE_NAME,
  SESSION_META_NAME,
  THREAD_META_FILE_SUFFIX,
  THREADS_DIRECTORY_NAME,
} from '../../../../packages/harness/src/store/sessions/paths'

export type IdMap = ReadonlyMap<string, string>
export type JsonRecord = Record<string, unknown>

export enum EFixtureFile {
  RootMeta = 'root-meta',
  Ledger = 'ledger',
  ThreadMeta = 'thread-meta',
  ThreadEvents = 'thread-events',
  Opaque = 'opaque',
}

const KEY_SEPARATOR = '/'
const THREAD_FILE_DEPTH = 2

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function remapIds({ value, ids }: { value: unknown; ids: IdMap }): unknown {
  if (typeof value === 'string') return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => remapIds({ value: item, ids }))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([field, item]) => [field, remapIds({ value: item, ids })]),
  )
}

const threadFileOf = ({ key }: { key: string }): { id: string; kind: EFixtureFile } | undefined => {
  const parts = key.split(KEY_SEPARATOR)
  if (parts.length !== THREAD_FILE_DEPTH || parts[0] !== THREADS_DIRECTORY_NAME) return undefined
  const name = parts[1] ?? ''
  if (name.endsWith(THREAD_META_FILE_SUFFIX)) {
    return { id: name.slice(0, -THREAD_META_FILE_SUFFIX.length), kind: EFixtureFile.ThreadMeta }
  }
  if (name.endsWith(EVENTS_FILE_SUFFIX)) {
    return { id: name.slice(0, -EVENTS_FILE_SUFFIX.length), kind: EFixtureFile.ThreadEvents }
  }
  return undefined
}

export function classifyKey({ key }: { key: string }): EFixtureFile {
  if (key === SESSION_META_NAME) return EFixtureFile.RootMeta
  if (key === LEDGER_FILE_NAME) return EFixtureFile.Ledger
  return threadFileOf({ key })?.kind ?? EFixtureFile.Opaque
}

export function threadMetaIdOf({ key }: { key: string }): string | undefined {
  const file = threadFileOf({ key })
  return file?.kind === EFixtureFile.ThreadMeta ? file.id : undefined
}

const THREAD_META_TEMP_PATTERN = /\.meta\.json\.[^/]+\.tmp$/

export function isThreadMetaTemp({ key }: { key: string }): boolean {
  const parts = key.split(KEY_SEPARATOR)
  return (
    parts.length === THREAD_FILE_DEPTH &&
    parts[0] === THREADS_DIRECTORY_NAME &&
    THREAD_META_TEMP_PATTERN.test(parts[1] ?? '')
  )
}

export function threadIdOfKey({ key }: { key: string }): string | undefined {
  const file = threadFileOf({ key })
  if (file !== undefined) return file.id
  const parts = key.split(KEY_SEPARATOR)
  if (parts[0] !== THREADS_DIRECTORY_NAME || parts.length <= THREAD_FILE_DEPTH) return undefined
  return parts[1]
}

export function mappedKey({ key, ids }: { key: string; ids: IdMap }): string {
  const file = threadFileOf({ key })
  if (file !== undefined) {
    const next = ids.get(file.id)
    if (next === undefined) return key
    const suffix =
      file.kind === EFixtureFile.ThreadMeta ? THREAD_META_FILE_SUFFIX : EVENTS_FILE_SUFFIX
    return `${THREADS_DIRECTORY_NAME}${KEY_SEPARATOR}${next}${suffix}`
  }
  const parts = key.split(KEY_SEPARATOR)
  if (parts[0] !== THREADS_DIRECTORY_NAME || parts.length <= THREAD_FILE_DEPTH) return key
  const next = ids.get(parts[1] ?? '')
  if (next === undefined) return key
  return [parts[0], next, ...parts.slice(THREAD_FILE_DEPTH)].join(KEY_SEPARATOR)
}

export function rewriteRootMeta({
  meta,
  ids,
  rootId,
  workspace,
}: {
  meta: JsonRecord
  ids: IdMap
  rootId: string
  workspace: string
}): JsonRecord {
  const remapped = remapIds({ value: meta, ids })
  return {
    ...(isRecord(remapped) ? remapped : {}),
    id: rootId,
    home: EExecutionLocation.Host,
    repo: workspace,
    workspace,
    worktree: null,
  }
}

export function rewriteThreadMeta({
  meta,
  ids,
  threadId,
  workspace,
}: {
  meta: JsonRecord
  ids: IdMap
  threadId: string
  workspace: string
}): JsonRecord {
  const remapped = remapIds({ value: meta, ids })
  return {
    ...(isRecord(remapped) ? remapped : {}),
    id: threadId,
    workspace,
    repo: workspace,
    executionLocation: EExecutionLocation.Host,
    placement: {
      placement: { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host },
      revision: 0,
      move: null,
    },
    parkedTranscript: null,
  }
}

export function rewriteJsonLines({ text, ids }: { text: string; ids: IdMap }): {
  text: string
  lines: number
} {
  let lines = 0
  const rewritten = text.split('\n').map((raw) => {
    if (raw === '') return raw
    lines += 1
    try {
      return JSON.stringify(remapIds({ value: JSON.parse(raw), ids }))
    } catch {
      return raw
    }
  })
  return { text: rewritten.join('\n'), lines }
}
