import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { GitRun } from '../run-git'
import { exists, makeDirs, type Journal } from './restore-files'
import type { IncomingRef } from './restore-types'

const SAFE_CONFIG = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=0',
  '-c', 'trace2.eventTarget=',
  '-c', 'trace2.normalTarget=',
  '-c', 'trace2.perfTarget=',
] as const
const REDIRECTING = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_QUARANTINE_PATH',
])
const TRACES = { GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0' }
const isInherited = (key: string): boolean => !REDIRECTING.has(key) && !key.startsWith('GIT_TRACE')
const FIELDS = '%(refname)%09%(objectname)%09%(symref)'

export async function git({ args, cwd }: { args: readonly string[]; cwd: string }): Promise<GitRun> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isInherited(key)) env[key] = value
  }
  Object.assign(env, TRACES)
  try {
    const proc = Bun.spawn(['git', ...SAFE_CONFIG, ...args], { cwd, env, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
    const [stdout, stderr, status] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { ok: status === 0, stdout, stderr }
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

export async function mustGit({ args, cwd }: { args: readonly string[]; cwd: string }): Promise<string> {
  const run = await git({ args, cwd })
  if (!run.ok) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${run.stderr.trim()}`)
  return run.stdout
}

export async function readRefs({ cwd, gitDir }: { cwd: string; gitDir?: string }): Promise<IncomingRef[]> {
  const prefix = gitDir === undefined ? [] : ['--git-dir', gitDir]
  const out = await mustGit({ args: [...prefix, 'for-each-ref', `--format=${FIELDS}`], cwd })
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [ref = '', sha = '', symref = ''] = line.split('\t')
      return { ref, sha, symref }
    })
}

const PACK = '.pack'
const IDX = '.idx'

const copyAtomically = async ({ source, target }: { source: string; target: string }): Promise<void> => {
  const partial = `${target}.${randomBytes(4).toString('hex')}.partial`
  try {
    await copyFile(source, partial)
    await rename(partial, target)
  } finally {
    await rm(partial, { force: true })
  }
}

const isIntact = async ({ target, cwd }: { target: string; cwd: string }): Promise<boolean> => {
  if (!(await exists(target))) return false
  if (!target.endsWith(PACK)) return true
  const index = `${target.slice(0, -PACK.length)}${IDX}`
  if (!(await exists(index))) return false
  return (await git({ args: ['verify-pack', index], cwd })).ok
}

const setAside = async (target: string): Promise<void> => {
  if (await exists(target)) await rename(target, `${target}.corrupt-${randomBytes(3).toString('hex')}`)
}

const copyMissing = async ({ from, to, cwd }: { from: string; to: string; cwd: string }): Promise<void> => {
  const entries = await readdir(from, { withFileTypes: true })
  const ordered = [...entries].sort((a, b) => Number(a.name.endsWith(IDX)) - Number(b.name.endsWith(IDX)))
  for (const entry of ordered) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true })
      await copyMissing({ from: source, to: target, cwd })
      continue
    }
    if (await isIntact({ target, cwd })) continue
    await setAside(target)
    await copyAtomically({ source, target })
  }
}

export async function importObjects({ stageGit, commonDir, journal }: { stageGit: string; commonDir: string; journal: Journal }): Promise<void> {
  await makeDirs({ path: join(commonDir, 'objects'), journal })
  await copyMissing({ from: join(stageGit, 'objects'), to: join(commonDir, 'objects'), cwd: commonDir })
  for (const name of await readdir(stageGit)) {
    if (!name.startsWith('sharedindex.')) continue
    const target = join(commonDir, name)
    if (await exists(target)) continue
    await copyAtomically({ source: join(stageGit, name), target })
  }
}

const undoGit = async ({ args, cwd }: { args: readonly string[]; cwd: string }): Promise<void> => {
  await mustGit({ args, cwd })
}

export async function createRef({ cwd, ref, sha, journal }: { cwd: string; ref: string; sha: string; journal: Journal }): Promise<void> {
  await mustGit({ args: ['update-ref', ref, sha, ''], cwd })
  journal.undo.push(() => undoGit({ args: ['update-ref', '-d', ref, sha], cwd }))
}

export async function moveRef({ cwd, ref, sha, previous, journal }: { cwd: string; ref: string; sha: string; previous: string; journal: Journal }): Promise<void> {
  await mustGit({ args: ['update-ref', ref, sha, previous], cwd })
  journal.undo.push(() => undoGit({ args: ['update-ref', ref, previous, sha], cwd }))
}

export async function createSymref({ cwd, ref, target, journal }: { cwd: string; ref: string; target: string; journal: Journal }): Promise<void> {
  await mustGit({ args: ['symbolic-ref', ref, target], cwd })
  journal.undo.push(() => undoGit({ args: ['symbolic-ref', '--delete', ref], cwd }))
}

export async function isAncestor({ cwd, from, to }: { cwd: string; from: string; to: string }): Promise<boolean> {
  return (await git({ args: ['merge-base', '--is-ancestor', from, to], cwd })).ok
}

const timeOf = (line: string): number => Number(/> (\d+) /.exec(line)?.[1] ?? 0)

const linesOf = async (path: string): Promise<string[]> =>
  (await readFile(path, 'utf8').catch(() => '')).split('\n').filter((line) => line.length > 0)

export async function copyReflog({ stageGit, commonDir, from, to, journal }: { stageGit: string; commonDir: string; from: string; to: string; journal: Journal }): Promise<void> {
  const source = join(stageGit, 'logs', from)
  const target = join(commonDir, 'logs', to)
  if (!(await exists(source))) return
  const previous = await readFile(target).catch(() => null)
  const host = await linesOf(target)
  const known = new Set(host)
  const merged = [...host, ...(await linesOf(source)).filter((line) => !known.has(line))]
    .map((line, index) => ({ line, index }))
    .sort((a, b) => timeOf(a.line) - timeOf(b.line) || a.index - b.index)
    .map((item) => item.line)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${merged.join('\n')}\n`)
  journal.undo.push(async () => {
    if (previous === null) await rm(target, { force: true })
    else await writeFile(target, previous)
  })
}
