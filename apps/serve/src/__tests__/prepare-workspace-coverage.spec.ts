import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { captureWorkspaceArchive, runGit } from '@dltech/atlas-harness'

import { prepareWorkspaceExport } from '../prepare-workspace'

const threadId = toThreadId('thread-coverage')
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const git = async ({ cwd, args }: { cwd: string; args: readonly string[] }): Promise<string> => {
  const run = await runGit({
    args: ['-c', 'user.name=Spec', '-c', 'user.email=spec@example.com', '-c', 'commit.gpgsign=false', ...args],
    cwd,
  })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
  return run.stdout.trim()
}

type Fixture = { home: string; main: string; active: string; peer: string }

const fixture = async (): Promise<Fixture> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-prepare-coverage-')))
  roots.push(root)
  const main = join(root, 'repo')
  await mkdir(main, { recursive: true })
  await git({ cwd: main, args: ['init', '--initial-branch=main'] })
  await writeFile(join(main, '.gitignore'), '.atlas/\n')
  await writeFile(join(main, 'app.ts'), 'export const one = 1\n')
  await git({ cwd: main, args: ['add', '-A'] })
  await git({ cwd: main, args: ['commit', '-m', 'seed'] })
  return {
    home: join(root, 'home'),
    main,
    active: join(main, '.atlas', 'worktrees', 'active'),
    peer: join(main, '.atlas', 'worktrees', 'peer'),
  }
}

const addActive = async ({ main, active }: Fixture): Promise<void> => {
  await git({ cwd: main, args: ['worktree', 'add', active, '-b', 'active'] })
  await writeFile(join(active, 'feature.ts'), 'export const feature = true\n')
  await git({ cwd: active, args: ['add', 'feature.ts'] })
}

const addPeerWithWork = async ({ main, peer }: Fixture): Promise<void> => {
  await git({ cwd: main, args: ['worktree', 'add', peer, '-b', 'peer-work'] })
  await writeFile(join(peer, 'unpublished.ts'), 'export const unpublished = true\n')
  await git({ cwd: peer, args: ['add', 'unpublished.ts'] })
  await git({ cwd: peer, args: ['commit', '-m', 'unpublished peer commit'] })
  await writeFile(join(peer, 'dirty.txt'), 'uncommitted peer edit\n')
  await mkdir(join(peer, '.atlas', 'children'), { recursive: true })
  await writeFile(join(peer, '.atlas', 'children', 'finished.log'), 'finished child output\n')
}

const prepare = ({
  home,
  cwd,
  capture = captureWorkspaceArchive,
  stopProcesses,
}: {
  home: string
  cwd: string
  capture?: typeof captureWorkspaceArchive
  stopProcesses?: () => Promise<void>
}) =>
  prepareWorkspaceExport({
    driveHome: home,
    threadId,
    launchDirectory: cwd,
    log: { readOwn: async () => [] },
    capture,
    stopProcesses,
  })

const exportNames = async (home: string): Promise<string[]> =>
  existsSync(join(home, 'exports')) ? readdir(join(home, 'exports')) : []

describe('preparing an export of a repository with omitted checkouts', () => {
  it('refuses a dirty unpublished peer before stopping or capturing, and leaves it intact', async () => {
    const setup = await fixture()
    await addActive(setup)
    await addPeerWithWork(setup)
    const peerHead = await git({ cwd: setup.main, args: ['rev-parse', 'peer-work'] })
    await mkdir(join(setup.home, 'exports'), { recursive: true })
    await writeFile(join(setup.home, 'exports', 'workspace-older.tar.gz'), 'older')
    const calls: string[] = []

    const refusal = prepare({
      home: setup.home,
      cwd: setup.active,
      stopProcesses: async () => {
        calls.push('stop')
      },
      capture: async (args) => {
        calls.push('capture')
        return captureWorkspaceArchive(args)
      },
    })

    await expect(refusal).rejects.toThrow(setup.peer)
    await expect(refusal).rejects.toThrow('stays in the cloud session')
    expect(calls).toEqual([])
    expect(await exportNames(setup.home)).toEqual(['workspace-older.tar.gz'])
    expect(await readFile(join(setup.peer, 'dirty.txt'), 'utf8')).toBe('uncommitted peer edit\n')
    expect(await readFile(join(setup.peer, '.atlas', 'children', 'finished.log'), 'utf8')).toBe(
      'finished child output\n',
    )
    expect(await git({ cwd: setup.main, args: ['rev-parse', 'peer-work'] })).toBe(peerHead)
  })

  it('refuses a sibling nested below the covered main when only main is active', async () => {
    const setup = await fixture()
    await git({ cwd: setup.main, args: ['worktree', 'add', setup.peer, '-b', 'nested'] })

    await expect(prepare({ home: setup.home, cwd: setup.main })).rejects.toThrow(setup.peer)
    expect(await exportNames(setup.home)).toEqual([])
  })

  it('refuses again against the actual manifest when a sibling appears during capture', async () => {
    const setup = await fixture()
    await addActive(setup)

    await expect(
      prepare({
        home: setup.home,
        cwd: setup.active,
        capture: async (args) => {
          const manifest = await captureWorkspaceArchive(args)
          await git({ cwd: setup.main, args: ['worktree', 'add', setup.peer, '-b', 'late-peer'] })
          return manifest
        },
      }),
    ).rejects.toThrow(setup.peer)

    expect(await exportNames(setup.home)).toEqual([])
  })

  it('exports main plus the active worktree when nothing else is registered', async () => {
    const setup = await fixture()
    await addActive(setup)

    const reply = await prepare({ home: setup.home, cwd: setup.active })

    expect(reply.manifest.trees.map((tree) => tree.sourcePath)).toEqual([setup.main, setup.active])
    expect(existsSync(reply.path)).toBe(true)
  })

  it('exports a plain directory that is not a repository', async () => {
    const setup = await fixture()
    const plain = join(setup.home, 'plain')
    await mkdir(plain, { recursive: true })
    await writeFile(join(plain, 'notes.md'), 'notes\n')

    const reply = await prepare({ home: setup.home, cwd: plain })

    expect(reply.manifest.repository).toBeNull()
    expect(existsSync(reply.path)).toBe(true)
  })
})
