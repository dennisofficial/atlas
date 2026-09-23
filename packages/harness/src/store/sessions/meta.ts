import { mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { z } from 'zod'

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
})

export type SessionMeta = z.infer<typeof sessionMetaSchema>

export const threadMetaSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
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
})

export type ThreadMeta = z.infer<typeof threadMetaSchema>

export function newThreadMeta({ id, at }: { id: string; at: string }): ThreadMeta {
  return {
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
  }
}

export function readMetaSync<Meta>({
  file,
  schema,
}: {
  file: string
  schema: z.ZodType<Meta>
}): Meta | undefined {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  return schema.parse(JSON.parse(raw))
}

export async function writeMeta({ file, meta }: { file: string; meta: unknown }): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(meta, null, 2))
  await rename(tmp, file)
}
