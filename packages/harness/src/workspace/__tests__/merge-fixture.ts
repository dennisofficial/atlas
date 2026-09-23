import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGit, type GitRun } from '../run-git'

export const git = async (cwd: string, args: readonly string[]): Promise<GitRun> => {
  const run = await runGit({ args, cwd })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
  return run
}

export const commitAll = async (cwd: string, message: string): Promise<string> => {
  await git(cwd, ['add', '-A'])
  await git(cwd, [
    '-c',
    'user.name=Spec',
    '-c',
    'user.email=spec@example.com',
    'commit',
    '-m',
    message,
  ])
  return (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
}

export const commitTree = async (cwd: string, args: readonly string[]): Promise<string> =>
  (
    await git(cwd, [
      '-c',
      'user.name=Spec',
      '-c',
      'user.email=spec@example.com',
      'commit-tree',
      ...args,
    ])
  ).stdout.trim()

export const LIFTED = 'line one\nline two\nline three\n'
export const CARRIED = 'line one\nline two\nline three\nlifted line\n'

export type MergeScenario = {
  remote: string
  local: string
  cloud: string
  lifted: string
  patchedTree: string
}

/**
 * A bare "origin", the operator's local clone on main at the lifted commit with the lifted work
 * still uncommitted, and a cloud clone in the same shape — the arrival the materialization leaves
 * behind: on the branch, the patch uncommitted, the baseline tree recorded with the patch applied.
 */
export const scenario = async (): Promise<MergeScenario> => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-merge-'))
  const remote = join(root, 'remote.git')
  const local = join(root, 'local')
  const cloud = join(root, 'cloud')

  await git(root, ['init', '--bare', '--initial-branch=main', remote])
  await git(root, ['clone', '--', remote, cloud])
  writeFileSync(join(cloud, 'app.ts'), LIFTED)
  const lifted = await commitAll(cloud, 'lifted commit')
  await git(cloud, ['push', 'origin', 'HEAD:main'])

  writeFileSync(join(cloud, 'app.ts'), CARRIED)
  writeFileSync(join(cloud, 'notes.txt'), 'uncommitted at lift\n')
  await git(cloud, ['add', '-A'])
  const patchedTree = (await git(cloud, ['write-tree'])).stdout.trim()
  await git(cloud, ['reset'])

  await git(root, ['clone', '--', remote, local])
  writeFileSync(join(local, 'app.ts'), CARRIED)
  writeFileSync(join(local, 'notes.txt'), 'uncommitted at lift\n')

  return { remote, local, cloud, lifted, patchedTree }
}

/**
 * Mirrors the serve's publish: the coming-home commit carries the recorded baseline tree as a
 * second parent, so the host's fetch brings the tree the content merge keys on. Without
 * `baseTree` it publishes the old shape, and the host falls back to a locally-known base.
 */
export const publishFrom = async (cloud: string, baseTree?: string): Promise<string> => {
  const head = await commitAll(cloud, 'atlas: workspace coming home')
  let commit = head
  if (baseTree !== undefined) {
    const base = await commitTree(cloud, [baseTree, '-m', 'atlas: lift baseline'])
    const tree = (await git(cloud, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
    commit = await commitTree(cloud, [
      tree,
      '-p',
      head,
      '-p',
      base,
      '-m',
      'atlas: workspace coming home',
    ])
  }
  const ref = `refs/atlas/descend/brn_spec-${commit.slice(0, 12)}`
  await git(cloud, ['push', 'origin', `${commit}:${ref}`])
  return ref
}

export const staged = async (cwd: string): Promise<string> =>
  (await git(cwd, ['diff', '--cached', '--name-only'])).stdout

export const headOf = async (cwd: string): Promise<string> =>
  (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
