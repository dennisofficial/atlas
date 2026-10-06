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

export function createSessionContextFolderStateStore(args: {
  threadId: ThreadId
  home?: string
}): ContextFolderStateStore {
  const file = async () => {
    const sessionDir = await registryFor({ home: args.home ?? atlasDirectory() })
      .sessionDirFor({ threadId: args.threadId })
    return join(sessionDir, CONTEXT_FOLDER_STATE_FILE_NAME)
  }
  let pendingSave: Promise<void> = Promise.resolve()

  return {
    load: async () => readClosedPaths({ path: await file() }),
    save: (closed) => {
      const closedPaths = cleanClosedPaths({ candidates: closed })
      const write = pendingSave.then(async () => {
        await writeMeta({ file: await file(), meta: { closed: closedPaths } })
      })
      pendingSave = write.catch(() => {})
      return write
    },
  }
}
