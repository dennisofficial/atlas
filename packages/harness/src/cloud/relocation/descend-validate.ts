import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { z } from 'zod'

import { EUnreadableReason } from '../../store/decode-events'
import { parseEventLines } from '../../store/sessions/lines'
import {
  readMeta,
  readSessionMetaSync,
  threadMetaSchema,
  type ThreadMeta,
} from '../../store/sessions/meta'
import {
  eventLogFile,
  sessionMetaFile,
  threadMetaFile,
  threadsDirectory,
} from '../../store/sessions/paths'

export const TRANSCRIPT_ORIGIN_FILE_NAME = 'transcript-origin.json'

export const transcriptOriginSchema = z.object({
  threadId: z.string().min(1),
  archiveDigest: z.string().nullable(),
  initialized: z.literal(true),
})

export type TranscriptOrigin = z.infer<typeof transcriptOriginSchema>

export type ValidatedIncomingRoot = {
  provenance: TranscriptOrigin | undefined
  rootSpeaks: boolean
}

const CONVERSATIONAL_TYPES: ReadonlySet<string> = new Set([
  'user-said',
  'assistant-said',
  'tool-called',
  'tool-result',
  'tool-denied',
  'history-compacted',
])

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const errorCodeOf = ({ error }: { error: unknown }): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

const readProvenance = async (args: {
  sessionDir: string
  threadId: ThreadId
}): Promise<TranscriptOrigin | undefined> => {
  const file = join(args.sessionDir, TRANSCRIPT_ORIGIN_FILE_NAME)
  const text = await readFile(file, 'utf8').catch((error: unknown) => {
    if (errorCodeOf({ error }) === 'ENOENT') return undefined
    throw new Error(
      `the cloud transcript provenance marker could not be read (${messageOf(error)}) — refusing to wipe the local copy`,
    )
  })
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(
      'the cloud transcript provenance marker is not valid JSON — refusing to wipe the local copy',
    )
  }
  const origin = transcriptOriginSchema.safeParse(parsed)
  if (!origin.success) {
    throw new Error(
      'the cloud transcript provenance marker is malformed — refusing to wipe the local copy',
    )
  }
  if (origin.data.threadId !== args.threadId) {
    throw new Error(
      'the cloud transcript provenance marker names a different session — refusing to wipe the local copy',
    )
  }
  return origin.data
}

type ParsedThreadLog = {
  speaks: boolean
  spawned: ThreadId[]
  head: number
}

const readThreadLog = async (args: {
  sessionDir: string
  threadId: ThreadId
  label: string
}): Promise<ParsedThreadLog> => {
  const file = eventLogFile({ sessionDir: args.sessionDir, threadId: args.threadId })
  const text = await readFile(file, 'utf8').catch((error: unknown) => {
    throw new Error(
      `the cloud transcript has no readable ${args.label} event log (${messageOf(error)}) — refusing to wipe the local copy`,
    )
  })
  const parsed = parseEventLines({ text, threadId: args.threadId })
  const torn = parsed.unreadable.some((row) => row.reason === EUnreadableReason.TruncatedTail)
  if (args.label !== 'main-thread' && torn) {
    throw new Error(
      `the cloud transcript ${args.label} event log ends in a torn line — refusing to wipe the local copy`,
    )
  }
  const dropped = parsed.unreadable.filter((row) => row.reason !== EUnreadableReason.TruncatedTail)
  if (dropped.length > 0) {
    throw new Error(
      `the cloud transcript ${args.label} event log holds ${dropped.length} unreadable rows — refusing to wipe the local copy`,
    )
  }
  return {
    speaks: parsed.events.some((event) => CONVERSATIONAL_TYPES.has(event.type)),
    spawned: parsed.events
      .filter((event) => event.type === 'agent-spawned')
      .map((event) => toThreadId(event.agentId)),
    head: parsed.head,
  }
}

const localRootSpeaks = async (args: {
  sessionDir: string
  threadId: ThreadId
}): Promise<boolean> => {
  const localText = await readFile(
    eventLogFile({ sessionDir: args.sessionDir, threadId: args.threadId }),
    'utf8',
  ).catch((error: unknown) => {
    if (errorCodeOf({ error }) === 'ENOENT') return undefined
    throw new Error(
      `the local transcript log could not be checked (${messageOf(error)}) — refusing to wipe the local copy`,
    )
  })
  if (localText === undefined) return false
  const local = parseEventLines({ text: localText, threadId: args.threadId })
  return local.events.some((event) => CONVERSATIONAL_TYPES.has(event.type))
}

const requireIncomingRootMeta = (args: { sessionDir: string; threadId: ThreadId }): void => {
  let meta
  try {
    meta = readSessionMetaSync({
      file: sessionMetaFile({ sessionDir: args.sessionDir }),
      sessionDir: args.sessionDir,
    })
  } catch (error) {
    throw new Error(
      `the cloud transcript root metadata is unreadable (${messageOf(error)}) — refusing to wipe the local copy`,
    )
  }
  if (meta === undefined) {
    throw new Error('the cloud transcript holds no root metadata — refusing to wipe the local copy')
  }
  if (meta.id !== args.threadId) {
    throw new Error(
      'the cloud transcript root metadata names a different session — refusing to wipe the local copy',
    )
  }
}

export const requireValidatedIncomingRoot = async (args: {
  sessionDir: string
  threadId: ThreadId
  localDir: string
}): Promise<ValidatedIncomingRoot> => {
  requireIncomingRootMeta({ sessionDir: args.sessionDir, threadId: args.threadId })
  const provenance = await readProvenance({
    sessionDir: args.sessionDir,
    threadId: args.threadId,
  })
  const rootLog = await readThreadLog({
    sessionDir: args.sessionDir,
    threadId: args.threadId,
    label: 'main-thread',
  })
  const localSpeaks = await localRootSpeaks({
    sessionDir: args.localDir,
    threadId: args.threadId,
  })
  if (localSpeaks && !rootLog.speaks && provenance === undefined) {
    throw new Error(
      'the cloud transcript carries no conversation and no serve-stamped provenance, but the local copy holds history — refusing to wipe the local copy',
    )
  }
  return { provenance, rootSpeaks: rootLog.speaks }
}

const readIncomingThreadMeta = async (args: {
  sessionDir: string
  threadId: ThreadId
}): Promise<ThreadMeta> => {
  const meta = await readMeta({
    file: threadMetaFile({ sessionDir: args.sessionDir, threadId: args.threadId }),
    schema: threadMetaSchema,
  })
  if (meta === undefined) {
    throw new Error(
      `the cloud transcript thread ${args.threadId} has no readable metadata — refusing to wipe the local copy`,
    )
  }
  if (meta.id !== args.threadId) {
    throw new Error(
      `the cloud transcript thread metadata ${args.threadId} names a different thread — refusing to wipe the local copy`,
    )
  }
  return meta
}

const requireIncomingThread = async (args: {
  sessionDir: string
  threadId: ThreadId
}): Promise<ParsedThreadLog> => {
  const meta = await readIncomingThreadMeta({
    sessionDir: args.sessionDir,
    threadId: args.threadId,
  })
  const label = args.threadId.includes('/') ? 'child' : 'main-thread'
  const log = await readThreadLog({
    sessionDir: args.sessionDir,
    threadId: args.threadId,
    label: `${label} ${args.threadId}`,
  })
  if (log.head !== meta.head) {
    throw new Error(
      `the cloud transcript thread ${args.threadId} log decodes to head ${log.head} but its metadata says ${meta.head} — refusing to wipe the local copy`,
    )
  }
  return log
}

const THREAD_META_SUFFIX = '.meta.json'

const listThreadMetasUnder = async (args: {
  sessionDir: string
  root: string
  dir: string
  into: ThreadId[]
}): Promise<void> => {
  const entries = await readdir(args.dir, { withFileTypes: true }).catch((error: unknown) => {
    throw new Error(
      `the cloud transcript threads directory could not be read (${messageOf(error)}) — refusing to wipe the local copy`,
    )
  })
  for (const entry of entries) {
    const path = join(args.dir, entry.name)
    if (entry.isDirectory()) {
      await listThreadMetasUnder({ ...args, dir: path })
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(THREAD_META_SUFFIX)) continue
    const relativeName = relative(args.root, path.slice(0, -THREAD_META_SUFFIX.length))
      .split('/')
      .join('/')
    if (relativeName.startsWith('..') || relativeName === '') continue
    const derived = toThreadId(relativeName)
    if (threadMetaFile({ sessionDir: args.sessionDir, threadId: derived }) !== path) continue
    args.into.push(derived)
  }
}

const listIncomingThreadIds = async (args: { sessionDir: string }): Promise<ThreadId[]> => {
  const root = threadsDirectory({ sessionDir: args.sessionDir })
  const into: ThreadId[] = []
  await listThreadMetasUnder({ sessionDir: args.sessionDir, root, dir: root, into })
  return into
}

export const requireReadableIncomingFamily = async (args: {
  sessionDir: string
  root: ValidatedIncomingRoot
}): Promise<void> => {
  const present = await listIncomingThreadIds({ sessionDir: args.sessionDir })
  const referenced: ThreadId[] = []
  const logs = new Map<ThreadId, ParsedThreadLog>()
  for (const threadId of present) {
    logs.set(threadId, await requireIncomingThread({ sessionDir: args.sessionDir, threadId }))
  }
  for (const log of logs.values()) referenced.push(...log.spawned)
  for (const spawned of referenced) {
    if (!logs.has(spawned)) {
      throw new Error(
        `the cloud transcript still references child ${spawned} but the archive holds no readable thread for it — refusing to wipe the local copy`,
      )
    }
  }
}
