import { createReadStream } from 'node:fs'
import { lstat, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { captureGit } from './capture-git'

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const ZERO_ID = /^0+$/
const MISSING = /^([0-9a-f]+) missing$/

export async function reflogObjectIds({ path }: { path: string }): Promise<Set<string>> {
  const found = new Set<string>()
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    for (const field of line.split(' ', 2)) {
      if (OBJECT_ID.test(field) && !ZERO_ID.test(field)) found.add(field)
    }
  }
  return found
}

export enum ELogEntryKind {
  File = 'file',
  Symlink = 'symlink',
}

export type LogEntry = { path: string; absolute: string; kind: ELogEntryKind }

const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT'

export async function walkLogs({ root }: { root: string }): Promise<LogEntry[]> {
  const info = await lstat(root).catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })
  if (info === null) return []
  if (!info.isDirectory()) throw new Error(`Reflog root ${root} is not a directory`)
  const found: LogEntry[] = []
  const visit = async (relative: string): Promise<void> => {
    const directory = relative === '' ? root : join(root, relative)
    for (const dirent of await readdir(directory, { withFileTypes: true })) {
      const path = relative === '' ? dirent.name : `${relative}/${dirent.name}`
      const absolute = join(root, path)
      if (dirent.isDirectory()) await visit(path)
      else if (dirent.isSymbolicLink()) found.push({ path, absolute, kind: ELogEntryKind.Symlink })
      else if (dirent.isFile()) found.push({ path, absolute, kind: ELogEntryKind.File })
      else throw new Error(`Cannot capture reflog ${absolute}: only files and symbolic links are supported`)
    }
  }
  await visit('')
  return found.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

export const isCapturedCommonLog = ({ path, covered }: { path: string; covered: ReadonlySet<string> }): boolean =>
  !path.startsWith('refs/') || covered.has(path)

async function presentObjects({ cwd, ids }: { cwd: string; ids: ReadonlySet<string> }): Promise<string[]> {
  if (ids.size === 0) return []
  const scratch = await mkdtemp(join(tmpdir(), 'atlas-reflog-seeds-'))
  try {
    const stdinPath = join(scratch, 'ids')
    await writeFile(stdinPath, `${[...ids].join('\n')}\n`)
    const run = await captureGit({ args: ['cat-file', '--batch-check'], cwd, stdinPath })
    if (!run.ok) throw new Error(`Cannot check the reflog objects of ${cwd}: ${run.stderr.trim()}`)
    const absent = new Set(run.stdout.split('\n').flatMap((line) => MISSING.exec(line)?.[1] ?? []))
    return [...ids].filter((id) => !absent.has(id))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function reflogSeeds({
  cwd,
  commonLogFiles,
  linkedLogRoots,
}: {
  cwd: string
  commonLogFiles: readonly string[]
  linkedLogRoots: readonly string[]
}): Promise<string[]> {
  const linked = await Promise.all(linkedLogRoots.map((root) => walkLogs({ root })))
  const files = [...commonLogFiles, ...linked.flat().filter((entry) => entry.kind === ELogEntryKind.File).map((entry) => entry.absolute)]
  const ids = new Set<string>()
  for (const file of files) for (const id of await reflogObjectIds({ path: file })) ids.add(id)
  return presentObjects({ cwd, ids })
}
