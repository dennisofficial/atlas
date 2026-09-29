import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { atlasDirectory } from '@dltech/atlas-harness'

import type { ReaperListFailureMark } from './reaper'

export const REAPER_LIST_FAILURE_FILENAME = 'cloud-reaper-list-failure'

export function reaperListFailurePathFor(atlasHome: string): string {
  return join(atlasHome, REAPER_LIST_FAILURE_FILENAME)
}

const parseMark = (raw: string): ReaperListFailureMark | null => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (typeof record.message !== 'string' || record.message.length === 0) return null
  if (typeof record.notifiedAt !== 'number') return null

  return { message: record.message, notifiedAt: record.notifiedAt }
}

export async function readReaperListFailureMark(args: {
  path: string
}): Promise<ReaperListFailureMark | null> {
  const file = Bun.file(args.path)
  if (!(await file.exists())) return null

  try {
    return parseMark(await file.text())
  } catch {
    return null
  }
}

export async function writeReaperListFailureMark(args: {
  path: string
  mark: ReaperListFailureMark
}): Promise<void> {
  const tempPath = `${args.path}.${process.pid}.tmp`
  await Bun.write(tempPath, `${JSON.stringify(args.mark)}\n`)
  await rename(tempPath, args.path)
}

export async function clearReaperListFailureMark(args: { path: string }): Promise<void> {
  await rm(args.path, { force: true })
}

export const liveReaperListFailureMark = (): {
  readListFailureMark: () => Promise<ReaperListFailureMark | null>
  writeListFailureMark: (args: { mark: ReaperListFailureMark }) => Promise<void>
  clearListFailureMark: () => Promise<void>
} => {
  const path = reaperListFailurePathFor(atlasDirectory())
  return {
    readListFailureMark: () => readReaperListFailureMark({ path }),
    writeListFailureMark: ({ mark }) => writeReaperListFailureMark({ path, mark }),
    clearListFailureMark: () => clearReaperListFailureMark({ path }),
  }
}
