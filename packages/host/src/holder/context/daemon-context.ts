import type { FileStat, FileSystemEntry } from '@dltech/atlas-core'

export const CONTEXT_SCAN_LIMIT = 2_000

export type ContextReader = {
  readDirectory(args: { path: string }): Promise<readonly FileSystemEntry[]>
  stat(args: { path: string }): Promise<FileStat>
}

export type ScannedFile = { path: string; size: number; mtimeMs: number }

export type ContextScan = {
  files: readonly ScannedFile[]
  complete: boolean
  incompleteDirs: readonly string[]
}

const joinPath = (root: string, relative: string): string =>
  root.endsWith('/') ? `${root}${relative}` : `${root}/${relative}`

export const contextFilePathOf = (args: { root: string; path: string }): string =>
  joinPath(args.root, args.path)

type StatOutcome = { size: number; mtimeMs: number } | 'unreadable' | 'skipped'

const statOfFile = async (args: {
  files: ContextReader
  absolute: string
}): Promise<StatOutcome> => {
  const stat = await args.files.stat({ path: args.absolute }).catch(() => 'unreadable' as const)
  if (stat === 'unreadable') return 'unreadable'
  if (!stat.isFile()) return 'skipped'
  return { size: stat.size, mtimeMs: stat.mtimeMs }
}

type WalkState = { found: ScannedFile[]; incomplete: Set<string>; capped: boolean }

const walkDirectory = async (args: {
  files: ContextReader
  directory: string
  prefix: string
  state: WalkState
}): Promise<void> => {
  const state = args.state
  if (state.found.length >= CONTEXT_SCAN_LIMIT) {
    state.capped = true
    return
  }
  const entries = await args.files
    .readDirectory({ path: args.directory })
    .catch((error: unknown) => {
      if (args.prefix === '') throw error
      state.incomplete.add(args.prefix)
      return []
    })
  for (const entry of entries) {
    if (state.found.length >= CONTEXT_SCAN_LIMIT) {
      state.capped = true
      return
    }
    const relative = `${args.prefix}${entry.name}`
    if (entry.isDirectory()) {
      await walkDirectory({
        files: args.files,
        directory: joinPath(args.directory, entry.name),
        prefix: `${relative}/`,
        state,
      })
      continue
    }
    if (!entry.isFile()) continue
    const stat = await statOfFile({
      files: args.files,
      absolute: joinPath(args.directory, entry.name),
    })
    if (stat === 'unreadable') {
      state.incomplete.add(args.prefix)
      continue
    }
    if (stat === 'skipped') continue
    state.found.push({ ...stat, path: relative })
  }
}

export const scanContextDir = async (args: {
  files: ContextReader
  root: string
}): Promise<ContextScan> => {
  const state: WalkState = { found: [], incomplete: new Set(), capped: false }
  await walkDirectory({
    files: args.files,
    directory: args.root,
    prefix: '',
    state,
  })
  if (state.capped) return { files: state.found, complete: false, incompleteDirs: [] }
  return {
    files: state.found,
    complete: state.incomplete.size === 0,
    incompleteDirs: [...state.incomplete],
  }
}

export const contextRemovableFrom = (args: { scan: ContextScan; path: string }): boolean => {
  if (args.scan.complete) return true
  if (args.scan.incompleteDirs.length === 0) return false
  return !args.scan.incompleteDirs.some((dir) => args.path.startsWith(dir))
}
