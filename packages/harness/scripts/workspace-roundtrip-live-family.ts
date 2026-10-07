import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { liveGit } from './workspace-roundtrip-live-git'

export type LiveCheckoutSpec = {
  key: string
  label: string
  branch: string
  path: string
  ignored: Readonly<Record<string, string>>
  include: readonly string[] | null
  absentInCloud: readonly string[]
}

export const PRIVATE_REF = 'refs/worktree/probe'
export const CLOUD_INCLUDE_FILE = '.atlas/.cloudinclude'
export const FEATURE_KEY = 'feature'
export const HOST_UNRELATED_KEY = 'host-unrelated'
export const EXITED_RETAINED_KEY = 'teammate-5'
export const DIVERGED_KEYS: readonly string[] = [FEATURE_KEY, 'teammate-3']

export const CLOUD_EDITS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [FEATURE_KEY]: { 'file.txt': 'unstaged cloud\n', 'cloud-only.txt': 'cloud untracked\n' },
  'teammate-1': { 'file.txt': 'unstaged cloud t1\n' },
  'teammate-3': { 'file.txt': 'unstaged cloud t3\n', 'cloud-only.txt': 'cloud untracked t3\n' },
}

export const GITIGNORE = '.atlas/\nignored.txt\ncache/\n*.secret\n'

export const worktreesRoot = (repository: string): string => join(repository, '.atlas', 'worktrees')

const TEAMMATE_POLICIES: readonly Pick<LiveCheckoutSpec, 'ignored' | 'include' | 'absentInCloud'>[] = [
  { ignored: { 'ignored.txt': 'ignored t1\n', 'cache/drop.txt': 'drop t1\n' }, include: ['ignored.txt'], absentInCloud: ['cache/drop.txt'] },
  { ignored: { 'ignored.txt': 'ignored t2\n' }, include: null, absentInCloud: ['ignored.txt'] },
  { ignored: { 'keep.secret': 'keep t3\n', 'drop.secret': 'drop t3\n' }, include: ['keep.secret'], absentInCloud: ['drop.secret'] },
  { ignored: { 'a.secret': 'a t4\n', 'b.secret': 'b t4\n', 'ignored.txt': 'ignored t4\n' }, include: ['*.secret'], absentInCloud: ['ignored.txt'] },
  { ignored: { 'cache/one.txt': 'one t5\n', 'cache/deep/two.txt': 'two t5\n' }, include: ['cache/'], absentInCloud: [] },
]

export const featureSpec = (repository: string): LiveCheckoutSpec => ({
  key: FEATURE_KEY, label: 'local', branch: 'feature', path: join(worktreesRoot(repository), 'feature'),
  ignored: { 'ignored.txt': 'ignored local\n' }, include: ['ignored.txt'], absentInCloud: [],
})

export const teammateSpecs = (repository: string): LiveCheckoutSpec[] =>
  TEAMMATE_POLICIES.map((policy, index) => ({
    key: `teammate-${index + 1}`, label: `t${index + 1}`, branch: `teammate-${index + 1}`,
    path: join(worktreesRoot(repository), `teammate-${index + 1}`), ...policy,
  }))

export const hostUnrelatedSpec = (repository: string): LiveCheckoutSpec => ({
  key: HOST_UNRELATED_KEY, label: 'host-unrelated', branch: 'host-unrelated',
  path: join(worktreesRoot(repository), 'host-unrelated'),
  ignored: { 'ignored.txt': 'ignored host-unrelated\n' }, include: null, absentInCloud: [],
})

export const stagedContent = (spec: LiveCheckoutSpec): string => `staged ${spec.label}\n`
export const commitFileOf = (spec: LiveCheckoutSpec): string => `commit-${spec.key}.txt`

export function expectedFiles(spec: LiveCheckoutSpec): Record<string, string> {
  return {
    'file.txt': `unstaged ${spec.label}\n`,
    [commitFileOf(spec)]: `committed ${spec.label}\n`,
    'untracked.txt': `untracked ${spec.label}\n`,
    ...spec.ignored,
    ...(spec.include === null ? {} : { [CLOUD_INCLUDE_FILE]: `${spec.include.join('\n')}\n` }),
  }
}

export function filesExpectedAfterCloud(spec: LiveCheckoutSpec): Record<string, string> {
  const kept = Object.entries(expectedFiles(spec)).filter(([rel]) => !spec.absentInCloud.includes(rel))
  return { ...Object.fromEntries(kept), ...CLOUD_EDITS[spec.key] }
}

export function probeFilesOf(spec: LiveCheckoutSpec): string[] {
  return [...new Set([...Object.keys(expectedFiles(spec)), ...Object.keys(CLOUD_EDITS[spec.key] ?? {}), ...spec.absentInCloud])]
}

const withAbsentAsNull = ({ spec, present }: { spec: LiveCheckoutSpec; present: Record<string, string> }): Record<string, string | null> =>
  Object.fromEntries(probeFilesOf(spec).map((rel) => [rel, present[rel] ?? null]))

export const filesAfterLift = (spec: LiveCheckoutSpec): Record<string, string | null> =>
  withAbsentAsNull({ spec, present: Object.fromEntries(Object.entries(expectedFiles(spec)).filter(([rel]) => !spec.absentInCloud.includes(rel))) })

export const filesAfterCloud = (spec: LiveCheckoutSpec): Record<string, string | null> =>
  withAbsentAsNull({ spec, present: filesExpectedAfterCloud(spec) })

async function put(args: { root: string; rel: string; content: string }): Promise<void> {
  const file = join(args.root, args.rel)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, args.content)
}

export async function seedCheckout(args: { repository: string; spec: LiveCheckoutSpec }): Promise<void> {
  const { repository, spec } = args
  await liveGit({ cwd: repository, args: ['worktree', 'add', '-b', spec.branch, spec.path] })
  await put({ root: spec.path, rel: commitFileOf(spec), content: `committed ${spec.label}\n` })
  await liveGit({ cwd: spec.path, args: ['add', commitFileOf(spec)] })
  await liveGit({ cwd: spec.path, args: ['commit', '-m', `unpublished ${spec.key}`] })
  await liveGit({ cwd: spec.path, args: ['update-ref', PRIVATE_REF, 'HEAD'] })
  await put({ root: spec.path, rel: 'file.txt', content: stagedContent(spec) })
  await liveGit({ cwd: spec.path, args: ['add', 'file.txt'] })
  const files = expectedFiles(spec)
  for (const [rel, content] of Object.entries(files)) await put({ root: spec.path, rel, content })
}
