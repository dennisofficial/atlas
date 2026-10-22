import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readOriginUrl, remoteDefaultBranch } from '../remote-default-branch'
import { runGit } from '../run-git'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const freshDirectory = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-remote-branch-'))
  directories.push(dir)
  return dir
}

const git = async (args: { cwd: string; argv: string[] }): Promise<void> => {
  const run = await runGit({ args: args.argv, cwd: args.cwd })
  if (!run.ok) throw new Error(`git ${args.argv.join(' ')}: ${run.stderr}`)
}

const originWithDefault = async (branch: string): Promise<string> => {
  const root = await freshDirectory()
  const bare = join(root, 'origin.git')
  await git({ cwd: root, argv: ['init', '--bare', `--initial-branch=${branch}`, bare] })
  const seed = join(root, 'seed')
  await git({ cwd: root, argv: ['init', `--initial-branch=${branch}`, seed] })
  await git({ cwd: seed, argv: ['-c', 'user.email=a@b.c', '-c', 'user.name=n', 'commit', '--allow-empty', '-m', 'init'] })
  await git({ cwd: seed, argv: ['push', bare, branch] })
  return bare
}

describe('remoteDefaultBranch', () => {
  it('asks the remote when origin/HEAD is not cached', async () => {
    const bare = await originWithDefault('trunk')
    const checkout = await freshDirectory()
    await git({ cwd: checkout, argv: ['init', '--initial-branch=local'] })
    await git({ cwd: checkout, argv: ['remote', 'add', 'origin', bare] })

    expect(await remoteDefaultBranch({ cwd: checkout })).toBe('trunk')
  })

  it('reads the cached origin/HEAD from a clone', async () => {
    const bare = await originWithDefault('develop')
    const root = await freshDirectory()
    const clone = join(root, 'clone')
    await git({ cwd: root, argv: ['clone', bare, clone] })
    await git({ cwd: clone, argv: ['remote', 'set-url', 'origin', join(root, 'gone.git')] })

    expect(await remoteDefaultBranch({ cwd: clone })).toBe('develop')
  })

  it('answers null for a checkout with no origin', async () => {
    const checkout = await freshDirectory()
    await git({ cwd: checkout, argv: ['init'] })

    expect(await remoteDefaultBranch({ cwd: checkout })).toBeNull()
  })

  it('answers null when the remote cannot be reached', async () => {
    const checkout = await freshDirectory()
    await git({ cwd: checkout, argv: ['init'] })
    await git({ cwd: checkout, argv: ['remote', 'add', 'origin', join(checkout, 'missing.git')] })

    expect(await remoteDefaultBranch({ cwd: checkout })).toBeNull()
  })
})

describe('readOriginUrl', () => {
  it('reads the origin url', async () => {
    const checkout = await freshDirectory()
    await git({ cwd: checkout, argv: ['init'] })
    await git({ cwd: checkout, argv: ['remote', 'add', 'origin', 'git@github.com:comp-ai/atlas.git'] })

    expect(await readOriginUrl({ cwd: checkout })).toBe('git@github.com:comp-ai/atlas.git')
  })

  it('answers null with no origin', async () => {
    const checkout = await freshDirectory()
    await git({ cwd: checkout, argv: ['init'] })

    expect(await readOriginUrl({ cwd: checkout })).toBeNull()
  })
})
