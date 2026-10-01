import { lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import { remapPaths } from './capture-fingerprint'

export type Journal = {
  undo: Array<() => Promise<unknown>>
  backupRoot: string
}

const SKIPPED_TEXT = /(^|\/)(hooks|logs|refs|objects|info)\/|(^|\/)(index|packed-refs|HEAD|ORIG_HEAD)$|sharedindex\./

export const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false)

export const isDirectory = (path: string): Promise<boolean> =>
  lstat(path).then((info) => info.isDirectory(), () => false)

export async function isEmptyDirectory(path: string): Promise<boolean> {
  if (!(await isDirectory(path))) return false
  return (await readdir(path)).length === 0
}

export async function canonicalize(path: string): Promise<string> {
  const tail: string[] = []
  let probe = path
  while (!(await exists(probe)) && dirname(probe) !== probe) {
    tail.unshift(probe.slice(dirname(probe).length + 1))
    probe = dirname(probe)
  }
  return join(await realpath(probe), ...tail)
}

export async function makeDirs({ path, journal }: { path: string; journal: Journal }): Promise<void> {
  const missing: string[] = []
  for (let current = path; !(await exists(current)) && dirname(current) !== current; current = dirname(current)) {
    missing.unshift(current)
  }
  for (const dir of missing) {
    await mkdir(dir)
    journal.undo.push(() => rmdir(dir).catch(() => undefined))
  }
}

export async function moveEntry({ from, to, journal }: { from: string; to: string; journal: Journal }): Promise<void> {
  await makeDirs({ path: dirname(to), journal })
  await rename(from, to)
  journal.undo.push(() => rename(to, from))
}

export async function mergeInto({
  from,
  to,
  journal,
  replace = false,
}: {
  from: string
  to: string
  journal: Journal
  replace?: boolean
}): Promise<void> {
  if (!(await exists(to))) return moveEntry({ from, to, journal })
  const bothDirectories = (await isDirectory(from)) && (await isDirectory(to))
  if (!bothDirectories && replace) {
    await rm(to, { recursive: true, force: true })
    return moveEntry({ from, to, journal })
  }
  if (!bothDirectories) throw new Error(`cannot restore ${to}: something else already exists there`)
  for (const child of await readdir(from)) {
    await mergeInto({ from: join(from, child), to: join(to, child), journal, replace })
  }
}

export async function stashEntry({
  path,
  key,
  journal,
}: {
  path: string
  key: string
  journal: Journal
}): Promise<void> {
  if (!(await exists(path))) return
  await moveEntry({ from: path, to: join(journal.backupRoot, key), journal })
}

export async function stashTreeFiles({
  root,
  excluded,
  key,
  journal,
}: {
  root: string
  excluded: readonly string[]
  key: string
  journal: Journal
}): Promise<void> {
  const visit = async (directory: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name)
      if (directory === root && name === '.git') continue
      if (excluded.includes(path)) continue
      const holdsExcluded = excluded.some((other) => other.startsWith(`${path}${sep}`))
      if (holdsExcluded && (await isDirectory(path))) {
        await visit(path)
        continue
      }
      await stashEntry({ path, key: join(key, relative(root, path)), journal })
    }
  }
  await visit(root)
}

export async function remapTexts({
  root,
  paths,
  mapping,
}: {
  root: string
  paths: readonly string[]
  mapping: ReadonlyMap<string, string>
}): Promise<void> {
  if (mapping.size === 0) return
  for (const path of paths) {
    if (SKIPPED_TEXT.test(path)) continue
    const absolute = join(root, path)
    const info = await lstat(absolute).catch(() => null)
    if (info === null || !info.isFile()) continue
    const data = await readFile(absolute)
    if (data.includes(0)) continue
    const text = data.toString('utf8')
    const mapped = remapPaths({ text, mapping })
    if (mapped !== text) await writeFile(absolute, mapped)
  }
}

export async function pruneEmpty(path: string): Promise<void> {
  if (!(await isDirectory(path))) return
  for (const child of await readdir(path)) await pruneEmpty(join(path, child))
  await rmdir(path).catch(() => undefined)
}

export async function rollbackJournal({ journal, stage }: { journal: Journal; stage: string }): Promise<void> {
  const problems: string[] = []
  for (const undo of [...journal.undo].reverse()) {
    await undo().catch((error: unknown) => {
      problems.push(error instanceof Error ? error.message : String(error))
    })
  }
  journal.undo.length = 0
  if (problems.length > 0) {
    throw new Error(`workspace restore rollback was incomplete; incoming files are kept in ${stage}: ${problems.join('; ')}`)
  }
  await rm(stage, { recursive: true, force: true })
  await pruneEmpty(journal.backupRoot)
}
