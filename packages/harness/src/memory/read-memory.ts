import { mkdir, readFile, stat } from 'node:fs/promises'

import {
  boundedIndex,
  EContextSlot,
  EDefinitionOrigin,
  memoryIndexIn,
  memoryRootPlan,
} from '@dltech/atlas-core'

export type MemoryDirectories = {
  user: string
  project: string
}

export type LoadedMemoryIndex = {
  path: string
  directory: string
  slot: EContextSlot
  content: string
  wholeFile: boolean
  lines: number
  bytes: number
}

export type MemoryReadProblem = {
  path: string
  reason: string
}

export type MemoryRead = {
  indexes: readonly LoadedMemoryIndex[]
  problems: readonly MemoryReadProblem[]
}

export function memoryDirectoriesFor(args: {
  atlasHome: string
  repoRoot: string
  identity?: string | null | undefined
}): MemoryDirectories {
  const plan = memoryRootPlan(args)
  const directoryOf = (origin: EDefinitionOrigin): string =>
    plan.find((root) => root.origin === origin)?.directory ?? ''

  return {
    user: directoryOf(EDefinitionOrigin.User),
    project: directoryOf(EDefinitionOrigin.Project),
  }
}

export async function ensureMemoryDirectories(directories: MemoryDirectories): Promise<void> {
  await Promise.all(
    [directories.user, directories.project].map(async (directory) => {
      try {
        await mkdir(directory, { recursive: true })
      } catch {
        return
      }
    }),
  )
}

const readIndex = async (
  path: string,
): Promise<{
  content?: string
  wholeFile?: boolean
  lines?: number
  bytes?: number
  problem?: MemoryReadProblem
}> => {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return {}

    const raw = await readFile(path, 'utf8')
    if (raw.trim() === '') return {}

    const bounded = boundedIndex({ content: raw })
    return {
      content: bounded.text,
      wholeFile: !bounded.lineCapped && !bounded.byteCapped,
      lines: bounded.lines,
      bytes: bounded.bytes,
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : String(error)
    if (code === 'ENOENT') return {}

    return { problem: { path, reason: code } }
  }
}

export async function readMemoryIndexes(directories: MemoryDirectories): Promise<MemoryRead> {
  const indexes: LoadedMemoryIndex[] = []
  const problems: MemoryReadProblem[] = []

  for (const directory of [directories.user, directories.project]) {
    const path = memoryIndexIn(directory)
    const { content, wholeFile, lines, bytes, problem } = await readIndex(path)
    if (problem !== undefined) problems.push(problem)
    if (content === undefined) continue

    indexes.push({
      path,
      directory,
      slot: EContextSlot.Memory,
      content,
      wholeFile: wholeFile ?? true,
      lines: lines ?? 0,
      bytes: bytes ?? 0,
    })
  }

  return { indexes, problems }
}
