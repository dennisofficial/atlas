import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { captureGit } from './capture-git'

export type LogicalRef = { name: string; sha: string; symref: string }

export type CoveredTree = { sourcePath: string; branch: string | null }

const REF_FORMAT = '%(refname) %(objectname) %(symref)'
const PACKED_HEADER = '# pack-refs with: sorted\n'
const PER_WORKTREE_PREFIXES = ['refs/bisect/', 'refs/worktree/', 'refs/rewritten/'] as const
const STASH_REF = 'refs/stash'
const REQUIRED_DIRECTORIES = ['refs/heads', 'refs/tags'] as const

const parseRefs = (output: string): LogicalRef[] =>
  output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = '', sha = '', symref = ''] = line.split(' ')
      return { name, sha, symref }
    })

const isCovered = ({ ref, branch }: { ref: LogicalRef; branch: string | null }): boolean =>
  (branch !== null && ref.name === `refs/heads/${branch}`) ||
  PER_WORKTREE_PREFIXES.some((prefix) => ref.name.startsWith(prefix))

const listTreeRefs = async ({ tree }: { tree: CoveredTree }): Promise<LogicalRef[]> => {
  const patterns = [...(tree.branch === null ? [] : [`refs/heads/${tree.branch}`]), ...PER_WORKTREE_PREFIXES]
  if (patterns.length === 0) return []
  const run = await captureGit({ args: ['for-each-ref', `--format=${REF_FORMAT}`, ...patterns], cwd: tree.sourcePath })
  if (!run.ok) throw new Error(`Cannot list the refs of ${tree.sourcePath}: ${run.stderr.trim()}`)
  return parseRefs(run.stdout).filter((ref) => isCovered({ ref, branch: tree.branch }))
}

const stashRef = async ({ tree }: { tree: CoveredTree }): Promise<LogicalRef | null> => {
  const run = await captureGit({ args: ['rev-parse', '--verify', '--quiet', STASH_REF], cwd: tree.sourcePath })
  const sha = run.stdout.trim()
  if (!run.ok || sha.length === 0) return null
  return { name: STASH_REF, sha, symref: '' }
}

export type TreeRefs = { tree: CoveredTree & { isMain: boolean }; refs: LogicalRef[] }

export async function listTreeRefSets({ trees }: { trees: readonly (CoveredTree & { isMain: boolean })[] }): Promise<TreeRefs[]> {
  const sets: TreeRefs[] = []
  for (const tree of trees) {
    const refs = await listTreeRefs({ tree })
    const stash = await stashRef({ tree })
    if (stash !== null) refs.push(stash)
    sets.push({ tree, refs })
  }
  return sets
}

const byName = (left: LogicalRef, right: LogicalRef): number => left.name.localeCompare(right.name)

const isPrivate = (ref: LogicalRef): boolean => PER_WORKTREE_PREFIXES.some((prefix) => ref.name.startsWith(prefix))

export function commonRefsOf({ sets }: { sets: readonly TreeRefs[] }): LogicalRef[] {
  const found = new Map<string, LogicalRef>()
  for (const { tree, refs } of sets) {
    for (const ref of refs) {
      if (isPrivate(ref) && !tree.isMain) continue
      if (!found.has(ref.name)) found.set(ref.name, ref)
    }
  }
  return [...found.values()].sort(byName)
}

export const refTipsOf = ({ sets }: { sets: readonly TreeRefs[] }): string[] =>
  sets.flatMap(({ refs }) => refs.filter((ref) => ref.symref.length === 0).map((ref) => ref.sha))

export async function listCoveredRefs({ trees }: { trees: readonly CoveredTree[] }): Promise<LogicalRef[]> {
  const found = new Map<string, LogicalRef>()
  for (const tree of trees) {
    const refs = await listTreeRefs({ tree })
    const stash = await stashRef({ tree })
    if (stash !== null) refs.push(stash)
    for (const ref of refs) if (!found.has(ref.name)) found.set(ref.name, ref)
  }
  // the staged packed-refs header promises sorted order, which git reads with a binary search
  return [...found.values()].sort(byName)
}

export const digestLines = ({ refs }: { refs: readonly LogicalRef[] }): string[] =>
  refs.map((ref) => `ref\0${ref.name}\0${ref.sha}\0${ref.symref}`)

const isLoose = (ref: LogicalRef): boolean => ref.symref.length > 0 || isPrivate(ref)

export async function stageLogicalRefs({
  refs,
  outputDir,
}: {
  refs: readonly LogicalRef[]
  outputDir: string
}): Promise<string[]> {
  const names = new Set<string>(['packed-refs'])
  const addDirectories = (path: string): void => {
    for (let dir = dirname(path); dir !== '.'; dir = dirname(dir)) names.add(`${dir}/`)
  }
  for (const directory of REQUIRED_DIRECTORIES) {
    await mkdir(join(outputDir, directory), { recursive: true })
    addDirectories(`${directory}/x`)
  }
  const packed = refs.filter((ref) => !isLoose(ref))
  await writeFile(
    join(outputDir, 'packed-refs'),
    `${PACKED_HEADER}${packed.map((ref) => `${ref.sha} ${ref.name}\n`).join('')}`,
  )
  for (const ref of refs.filter(isLoose)) {
    const target = join(outputDir, ref.name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, ref.symref.length > 0 ? `ref: ${ref.symref}\n` : `${ref.sha}\n`)
    names.add(ref.name)
    addDirectories(ref.name)
  }
  return [...names].sort()
}
