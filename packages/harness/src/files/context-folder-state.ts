import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { z } from 'zod'
import type { ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'
import { writeMeta } from '../store/sessions/meta'
import { registryFor } from '../store/sessions/registry'
import { safeRelativeSegment } from './safe-relative-path'

export const CONTEXT_FOLDER_STATE_FILE_NAME = 'context-folders.json'

export type ContextFolderStateStore = {
  load: () => Promise<readonly string[]>
  save: (closed: readonly string[]) => Promise<void>
}

const stateShape = z.object({ closed: z.array(z.unknown()) })

function cleanClosedPaths({ candidates }: { candidates: readonly unknown[] }): string[] {
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '' || candidate.includes('\0')) continue
    const normalized = safeRelativeSegment(candidate)
    if (normalized === null) continue
    const trimmed = normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
    if (trimmed === '' || trimmed === '.') continue
    seen.add(trimmed)
  }
  return [...seen]
}

function isMissingFile({ error }: { error: unknown }): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
}

async function readClosedPaths({ path }: { path: string }): Promise<readonly string[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingFile({ error })) return []
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const state = stateShape.safeParse(parsed)
  if (!state.success) return []
  return cleanClosedPaths({ candidates: state.data.closed })
}

const fileQueues = new Map<string, Promise<void>>()
let admission: Promise<void> = Promise.resolve()

function runAfterPriorWrites<T>({ file, run }: { file: string; run: () => Promise<T> }): Promise<T> {
  const previous = fileQueues.get(file) ?? Promise.resolve()
  const result = previous.then(run)
  const tail = result.then(() => {}, () => {})
  fileQueues.set(file, tail)
  void tail.then(() => {
    if (fileQueues.get(file) === tail) fileQueues.delete(file)
  })
  return result
}

function admitInInvocationOrder<T>({
  resolveFile,
  run,
}: {
  resolveFile: () => Promise<string>
  run: (file: string) => Promise<T>
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    admission = admission.then(async () => {
      try {
        const file = await resolveFile()
        runAfterPriorWrites({ file, run: () => run(file) }).then(resolve, reject)
      } catch (error) {
        reject(error)
      }
    })
  })
}

export function createSessionContextFolderStateStore(args: {
  threadId: ThreadId
  home?: string
}): ContextFolderStateStore {
  const registry = () => registryFor({ home: args.home ?? atlasDirectory() })
  const readableFile = async () =>
    join(await registry().sessionDirFor({ threadId: args.threadId }), CONTEXT_FOLDER_STATE_FILE_NAME)
  const writableFile = async () => {
    const sessionDir = await registry().sessionDirOf({ threadId: args.threadId })
    if (sessionDir === undefined) throw new Error(`no session directory is registered for thread ${args.threadId}`)
    return join(sessionDir, CONTEXT_FOLDER_STATE_FILE_NAME)
  }

  return {
    load: () => admitInInvocationOrder({
      resolveFile: readableFile,
      run: (file) => readClosedPaths({ path: file }),
    }),
    save: (closed) => {
      const closedPaths = cleanClosedPaths({ candidates: closed })
      return admitInInvocationOrder({
        resolveFile: writableFile,
        run: (file) => writeMeta({ file, meta: { closed: closedPaths } }),
      })
    },
  }
}
