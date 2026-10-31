import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

import { z } from 'zod'

import type { LogPort, ThreadId } from '@dltech/atlas-core'
import { runtimeCheckpointSchema, transcriptCheckpointSchema } from '@dltech/atlas-wire'

import { withMirrorLock } from '../../cloud/mirror-lock'
import { logFieldsOf } from '../logs'
import { THREAD_META_FILE_SUFFIX } from './paths'
import { EThreadTitleSource } from './local-title-state'
import { writeMetaFile } from './meta-file'
import { canMigrateToCurrent, migrateSessionDirectory } from './migrations'

export const SESSION_FORMAT_VERSION = 1

export class SessionFromNewerAtlasError extends Error {
  constructor(args: { sessionDir: string; format: number }) {
    super(
      `${args.sessionDir} was written by a newer Atlas (format ${args.format}, this build reads ${SESSION_FORMAT_VERSION}); upgrade before opening it`,
    )
    this.name = 'SessionFromNewerAtlasError'
  }
}

const spendSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
})

export const sessionMetaSchema = z.object({
  format: z.number(),
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  home: z.string(),
  repo: z.string().nullable(),
  workspace: z.string().nullable(),
  worktree: z.string().nullable(),
  pullRequests: z.array(z.number()).nullable(),
  spend: spendSchema.nullable(),
  activeMainThreadId: z.string().nullish(),
})

export type SessionMeta = z.infer<typeof sessionMetaSchema>

export type MainThreadFence =
  | { allowed: true; generation: number }
  | { allowed: false; activeMain: ThreadId | null }

export abstract class SessionAuthorityPort {
  abstract activeMainOf(args: { sessionId: string }): Promise<ThreadId | undefined>
  abstract mainGenerationOf(args: { threadId: ThreadId }): Promise<number | undefined>
  abstract fenceMainThread(args: {
    threadId: ThreadId
    generation?: number | undefined
  }): Promise<MainThreadFence>
}

export const THREAD_META_VERSION = 1

export const threadMetaSchema = z.object({
  v: z.number().optional().default(THREAD_META_VERSION),
  id: z.string(),
  title: z.string().nullable(),
  titleSource: z.enum(EThreadTitleSource).optional(),
  titleRevision: z.number().int().nonnegative().optional(),
  head: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  parentThreadId: z.string().nullable(),
  forkSeq: z.number().nullable(),
  forkMode: z.string().nullable(),
  spawnerThreadId: z.string().nullable(),
  agentType: z.string().nullable(),
  workspace: z.string().nullable(),
  repo: z.string().nullable(),
  modelRef: z.string().nullable(),
  modelEffort: z.string().nullable(),
  executionLocation: z.string().nullable(),
  runner: z.string().nullish(),
  projectId: z.string().nullish(),
  placement: z
    .object({
      placement: z.union([
        z.object({ harness: z.literal('host'), tools: z.enum(['host', 'docker']) }),
        z.object({ harness: z.literal('cloud') }),
      ]),
      revision: z.number(),
    })
    .nullish(),
  parkedTranscript: z
    .object({
      checkpoint: runtimeCheckpointSchema,
      applied: transcriptCheckpointSchema.nullable(),
    })
    .nullish(),
})

export type ThreadMeta = z.infer<typeof threadMetaSchema>

export function newThreadMeta({ id, at }: { id: string; at: string }): ThreadMeta {
  return {
    v: THREAD_META_VERSION,
    id,
    title: null,
    head: 0,
    createdAt: at,
    updatedAt: at,
    parentThreadId: null,
    forkSeq: null,
    forkMode: null,
    spawnerThreadId: null,
    agentType: null,
    workspace: null,
    repo: null,
    modelRef: null,
    modelEffort: null,
    executionLocation: null,
    runner: null,
    projectId: null,
    placement: null,
    parkedTranscript: null,
  }
}

export function readMetaSync<Meta>({
  file,
  schema,
  logPort,
}: {
  file: string
  schema: z.ZodType<Meta>
  logPort?: LogPort | undefined
}): Meta | undefined {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (errorCodeOf({ error }) !== 'ENOENT') {
      logPort?.warn({
        source: 'store.meta',
        message: 'could not read a session meta file',
        data: { path: file, stage: 'read' },
        ...logFieldsOf({ error }),
      })
    }
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    logPort?.warn({
      source: 'store.meta',
      message: 'a session meta file is not valid JSON',
      data: { path: file, stage: 'parse' },
      ...logFieldsOf({ error }),
    })
    return undefined
  }
  return schema.parse(parsed)
}

export async function readMeta<Meta>({
  file,
  schema,
  logPort,
}: {
  file: string
  schema: z.ZodType<Meta>
  logPort?: LogPort | undefined
}): Promise<Meta | undefined> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (errorCodeOf({ error }) !== 'ENOENT') {
      logPort?.warn({
        source: 'store.meta',
        message: 'could not read a session meta file',
        data: { path: file, stage: 'read' },
        ...logFieldsOf({ error }),
      })
    }
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    logPort?.warn({
      source: 'store.meta',
      message: 'a session meta file is not valid JSON',
      data: { path: file, stage: 'parse' },
      ...logFieldsOf({ error }),
    })
    return undefined
  }
  return schema.parse(parsed)
}

export function readSessionMetaSync({
  file,
  sessionDir,
  logPort,
}: {
  file: string
  sessionDir: string
  logPort?: LogPort | undefined
}): SessionMeta | undefined {
  const meta = readMetaSync({ file, schema: sessionMetaSchema, logPort })
  if (meta === undefined) return undefined
  const format = meta.format
  if (format < SESSION_FORMAT_VERSION && canMigrateToCurrent({ format })) {
    migrateSessionDirectory({ sessionDir, from: format, logPort })
    return readMetaSync({ file, schema: sessionMetaSchema, logPort })
  }
  if (format !== SESSION_FORMAT_VERSION) {
    throw new SessionFromNewerAtlasError({ sessionDir, format })
  }
  return meta
}

function errorCodeOf({ error }: { error: unknown }): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export async function writeMeta({ file, meta }: { file: string; meta: unknown }): Promise<void> {
  if (!file.endsWith(THREAD_META_FILE_SUFFIX)) return writeMetaFile({ file, meta })
  await withMirrorLock({
    eventsFile: file,
    run: async () => {
      const current = await readMeta({ file, schema: threadMetaSchema })
      if (
        current === undefined ||
        (current.titleSource === undefined && (current.titleRevision ?? 0) === 0) ||
        typeof meta !== 'object' ||
        meta === null
      )
        return writeMetaFile({ file, meta })
      const incoming = threadMetaSchema.safeParse(meta)
      if (
        incoming.success &&
        incoming.data.titleSource !== undefined &&
        (incoming.data.titleRevision ?? 0) > (current.titleRevision ?? 0)
      )
        return writeMetaFile({ file, meta })
      await writeMetaFile({
        file,
        meta: {
          ...meta,
          title: current.title,
          titleSource: current.titleSource,
          titleRevision: current.titleRevision,
        },
      })
    },
  })
}
