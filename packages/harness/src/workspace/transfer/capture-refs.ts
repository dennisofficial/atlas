import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { captureGit } from './capture-git'

export type LogicalRef = { name: string; sha: string; symref: string }

const REF_FORMAT = '%(refname) %(objectname) %(symref)'
const PACKED_HEADER = '# pack-refs with: sorted\n'
const PER_WORKTREE_PREFIXES = ['refs/bisect/', 'refs/worktree/', 'refs/rewritten/'] as const
const REQUIRED_DIRECTORIES = ['refs/heads', 'refs/tags'] as const

export async function listLogicalRefs({ cwd }: { cwd: string }): Promise<LogicalRef[]> {
  const run = await captureGit({ args: ['for-each-ref', `--format=${REF_FORMAT}`], cwd })
  if (!run.ok) throw new Error(`Cannot list the refs of ${cwd}: ${run.stderr.trim()}`)
  return run.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = '', sha = '', symref = ''] = line.split(' ')
      return { name, sha, symref }
    })
}

export const digestLines = ({ refs }: { refs: readonly LogicalRef[] }): string[] =>
  refs.map((ref) => `ref\0${ref.name}\0${ref.sha}\0${ref.symref}`)

const isLoose = (ref: LogicalRef): boolean =>
  ref.symref.length > 0 || PER_WORKTREE_PREFIXES.some((prefix) => ref.name.startsWith(prefix))

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
