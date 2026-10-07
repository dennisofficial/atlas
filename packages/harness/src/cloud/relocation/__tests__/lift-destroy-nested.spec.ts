import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ELogSeverity } from '@dltech/atlas-core'

import { fingerprintWorkspaceTree } from '../../../workspace/transfer/capture-fingerprint'
import { runGit } from '../../../workspace/run-git'
import { destroyLiftedWorktree } from '../lift-destroy'
import { CapturingLog } from './fake-log'
import { CLOUD_THREAD } from './fixture'

const scratches: string[] = []

afterEach(async () => {
  await Promise.all(scratches.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const git = async ({ cwd, args }: { cwd: string; args: readonly string[] }): Promise<string> => {
  const run = await runGit({ cwd, args })
  if (!run.ok) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`)
  return run.stdout.trim()
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const makeRepo = async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-lift-nested-')))
  scratches.push(root)
  const main = join(root, 'repo')
  await mkdir(main, { recursive: true })
  await git({ cwd: main, args: ['init', '-b', 'main'] })
  await writeFile(join(main, 'README.md'), 'hello\n')
  await git({ cwd: main, args: ['add', '.'] })
  await git({ cwd: main, args: ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-m', 'initial'] })
  const session = join(root, 'session')
  await git({ cwd: main, args: ['worktree', 'add', session, '-b', 'session'] })
  return { root, main, session }
}

const addNested = async ({ main, path, branch }: { main: string; path: string; branch: string }): Promise<void> => {
  await git({ cwd: main, args: ['worktree', 'add', path, '-b', branch] })
  await writeFile(join(path, 'precious.txt'), 'not transferred\n')
}

const registrations = (main: string): Promise<string> => git({ cwd: main, args: ['worktree', 'list', '--porcelain'] })

const destroy = async ({ cwd, expected }: { cwd: string; expected: string }) => {
  const logPort = new CapturingLog()
  await destroyLiftedWorktree({ cwd, expected, logPort, threadId: CLOUD_THREAD })
  const warnings = logPort.entries.filter((entry) => entry.severity === ELogSeverity.Warn)
  return { warnings }
}

describe('a lifted worktree with registered descendants', () => {
  it('keeps an unrelated nested checkout and the outer tree although the outer fingerprint still matches', async () => {
    const repo = await makeRepo()
    const nested = join(repo.session, 'inner')
    await addNested({ main: repo.main, path: nested, branch: 'unrelated' })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })
    const before = await registrations(repo.main)

    const { warnings } = await destroy({ cwd: repo.session, expected })

    expect(await fingerprintWorkspaceTree({ cwd: repo.session })).toBe(expected)
    expect(await readFile(join(nested, 'precious.txt'), 'utf8')).toBe('not transferred\n')
    expect(await registrations(repo.main)).toBe(before)
    expect(await registrations(repo.main)).not.toContain('prunable')
    expect(await exists(repo.session)).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.message).toContain(repo.session)
    expect(warnings[0]?.message).toContain('other registered checkouts')
    expect(JSON.stringify(warnings[0]?.data)).toContain(nested)
  })

  it('keeps an owned nested checkout that changed after the outer fingerprint was taken', async () => {
    const repo = await makeRepo()
    const nested = join(repo.session, 'owned')
    await addNested({ main: repo.main, path: nested, branch: 'owned' })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })
    await writeFile(join(nested, 'late.txt'), 'changed after capture\n')

    const { warnings } = await destroy({ cwd: repo.session, expected })

    expect(await readFile(join(nested, 'late.txt'), 'utf8')).toBe('changed after capture\n')
    expect(await readFile(join(nested, 'precious.txt'), 'utf8')).toBe('not transferred\n')
    expect(warnings).toHaveLength(1)
  })

  it('keeps an owned nested checkout even when nothing changed, as the caller has no proof for it', async () => {
    const repo = await makeRepo()
    const nested = join(repo.session, 'owned')
    await addNested({ main: repo.main, path: nested, branch: 'owned' })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })

    await destroy({ cwd: repo.session, expected })

    expect(await exists(nested)).toBe(true)
    expect(await exists(repo.session)).toBe(true)
  })

  it('compares canonical identity when the session and the nested checkout are reached through a symlink', async () => {
    const repo = await makeRepo()
    const alias = join(repo.root, 'alias')
    await symlink(repo.session, alias)
    const nested = join(alias, 'aliased-inner')
    await addNested({ main: repo.main, path: nested, branch: 'aliased' })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })

    const { warnings } = await destroy({ cwd: alias, expected })

    expect(await readFile(join(repo.session, 'aliased-inner', 'precious.txt'), 'utf8')).toBe('not transferred\n')
    expect(await exists(repo.session)).toBe(true)
    expect(warnings).toHaveLength(1)
  })

  it('does not mistake a sibling whose name shares the outer path prefix for a descendant', async () => {
    const repo = await makeRepo()
    const sibling = join(repo.root, 'session-two')
    await addNested({ main: repo.main, path: sibling, branch: 'sibling' })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })

    await destroy({ cwd: repo.session, expected })

    expect(await exists(repo.session)).toBe(false)
    expect(await readFile(join(sibling, 'precious.txt'), 'utf8')).toBe('not transferred\n')
  })

  it('still removes the sole active tree when an unrelated checkout lives outside it', async () => {
    const repo = await makeRepo()
    const outside = join(repo.root, 'elsewhere')
    await addNested({ main: repo.main, path: outside, branch: 'elsewhere' })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })

    const { warnings } = await destroy({ cwd: repo.session, expected })

    expect(await exists(repo.session)).toBe(false)
    expect(warnings).toHaveLength(0)
    expect(await readFile(join(outside, 'precious.txt'), 'utf8')).toBe('not transferred\n')
    expect(await registrations(repo.main)).toContain(outside)
  })

  it('keeps the tree when a registered root cannot be resolved', async () => {
    const repo = await makeRepo()
    const vanished = join(repo.root, 'vanished')
    await addNested({ main: repo.main, path: vanished, branch: 'vanished' })
    await rm(vanished, { recursive: true, force: true })
    const expected = await fingerprintWorkspaceTree({ cwd: repo.session })

    const { warnings } = await destroy({ cwd: repo.session, expected })

    expect(await exists(repo.session)).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(JSON.stringify(warnings[0]?.data)).toContain(vanished)
  })
})
