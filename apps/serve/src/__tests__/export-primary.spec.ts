import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId, type Event } from '@dltech/atlas-core'
import { captureWorkspaceArchive, exportCwdOf, runGit, type RestoredWorkspace } from '@dltech/atlas-harness'

import { createDirectWorkspace } from '../direct-workspace'
import { driveWorkspaceArchivePath } from '../drive-bootstrap'
import { prepareWorkspaceExport } from '../prepare-workspace'
import { createWorkspaceSession } from '../workspace-session'
import type { ServeApp } from '../serve-app'

const threadId = toThreadId('thread-primary-export')
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const git = async (cwd: string, args: readonly string[]): Promise<void> => {
  const run = await runGit({
    args: ['-c', 'user.name=Spec', '-c', 'user.email=spec@example.com', '-c', 'commit.gpgsign=false', ...args],
    cwd,
  })
  if (!run.ok) throw new Error(`git ${args.join(' ')}: ${run.stderr || run.stdout}`)
}

const initRepository = async (path: string): Promise<void> => {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '--initial-branch=main'])
  await writeFile(join(path, 'app.ts'), 'export const one = 1\n')
  await git(path, ['add', '-A'])
  await git(path, ['commit', '-m', 'seed'])
}

type Layout = {
  root: string
  primary: string
  sibling: string
  linked: string
  primaryReceipt: RestoredWorkspace
}

const layout = async (): Promise<Layout> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-export-primary-')))
  roots.push(root)
  const workspaces = join(root, 'atlas', 'workspaces')
  const primary = join(workspaces, 'repo')
  const sibling = join(workspaces, 'cloned-elsewhere')
  const linked = join(primary, '.atlas', 'worktrees', 'feature')
  await initRepository(primary)
  await initRepository(sibling)
  await writeFile(join(primary, '.git', 'info', 'exclude'), '.atlas/\n')
  await git(primary, ['worktree', 'add', linked, '-b', 'feature'])
  const primaryReceipt: RestoredWorkspace = {
    cwd: primary,
    repository: primary,
    trees: [{ id: 'main', sourcePath: '/host/repo', path: primary, branch: 'main', renamedFrom: null }],
  }
  return { root, primary, sibling, linked, primaryReceipt }
}

const directoryChanged = (path: string): Event =>
  ({
    id: 'e',
    seq: 1,
    threadId,
    runId: 'r',
    depth: 0,
    at: '2026-10-06T00:00:00.000Z',
    type: 'directory-changed',
    path,
  }) as Event

describe('choosing the directory a cloud export captures', () => {
  it('keeps the current cwd when no primary was restored', async () => {
    const { sibling } = await layout()

    expect(await exportCwdOf({ cwd: sibling, primary: undefined })).toBe(sibling)
  })

  it('does not let an ephemeral sibling clone replace the primary', async () => {
    const { sibling, primary, primaryReceipt } = await layout()

    expect(await exportCwdOf({ cwd: sibling, primary: primaryReceipt })).toBe(primary)
    expect(await exportCwdOf({ cwd: join(sibling, '.git'), primary: primaryReceipt })).toBe(primary)
  })

  it('keeps the linked worktree and subdirectories of the primary', async () => {
    const { linked, primary, primaryReceipt } = await layout()
    await mkdir(join(primary, 'src'))
    await mkdir(join(linked, 'src'))

    expect(await exportCwdOf({ cwd: linked, primary: primaryReceipt })).toBe(linked)
    expect(await exportCwdOf({ cwd: join(linked, 'src'), primary: primaryReceipt })).toBe(join(linked, 'src'))
    expect(await exportCwdOf({ cwd: join(primary, 'src'), primary: primaryReceipt })).toBe(join(primary, 'src'))
  })

  it('falls back to the primary for a directory outside any repository', async () => {
    const { root, primary, primaryReceipt } = await layout()

    expect(await exportCwdOf({ cwd: root, primary: primaryReceipt })).toBe(primary)
  })

  it('treats a nested independent repository inside a plain primary as a sibling', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-export-plain-')))
    roots.push(root)
    const plain = join(root, 'atlas', 'workspaces', 'notes')
    const nested = join(plain, 'vendor', 'clone')
    await mkdir(join(plain, 'docs'), { recursive: true })
    await initRepository(nested)
    const receipt: RestoredWorkspace = {
      cwd: plain,
      repository: null,
      trees: [{ id: 'main', sourcePath: '/host/notes', path: plain, branch: null, renamedFrom: null }],
    }

    expect(await exportCwdOf({ cwd: join(plain, 'docs'), primary: receipt })).toBe(join(plain, 'docs'))
    expect(await exportCwdOf({ cwd: nested, primary: receipt })).toBe(plain)
    expect(await exportCwdOf({ cwd: root, primary: receipt })).toBe(plain)
  })
})

describe('exporting with a sibling clone entered', () => {
  it('captures the primary repository with its uncommitted edits, not the sibling', async () => {
    const { primary, sibling, primaryReceipt, root } = await layout()
    await writeFile(join(primary, 'edited-in-cloud.txt'), 'keep me')
    await writeFile(join(sibling, 'scratch.txt'), 'discard me')

    const reply = await prepareWorkspaceExport({
      driveHome: join(root, 'home'),
      threadId,
      launchDirectory: primary,
      primaryWorkspace: primaryReceipt,
      log: { readOwn: async () => [directoryChanged(sibling)] },
      capture: captureWorkspaceArchive,
    })

    expect(reply.manifest.repository?.sourcePath).toBe(primary)
    expect(reply.manifest.trees.map((tree) => tree.sourcePath)).toEqual([primary])
    const listing = Bun.spawnSync(['tar', '-tzf', reply.path]).stdout.toString()
    expect(listing).toContain('edited-in-cloud.txt')
    expect(listing).not.toContain('scratch.txt')
    expect(listing).not.toContain('cloned-elsewhere')
  })

  it('still captures the primary and its entered linked worktree', async () => {
    const { primary, linked, primaryReceipt, root } = await layout()
    await writeFile(join(linked, 'feature.ts'), 'export const feature = true\n')
    await git(linked, ['add', 'feature.ts'])

    const reply = await prepareWorkspaceExport({
      driveHome: join(root, 'home'),
      threadId,
      launchDirectory: primary,
      primaryWorkspace: primaryReceipt,
      log: { readOwn: async () => [directoryChanged(linked)] },
      capture: captureWorkspaceArchive,
    })

    expect(reply.manifest.trees.map((tree) => tree.sourcePath)).toEqual([primary, linked])
    const linkedTree = reply.manifest.trees.find((tree) => tree.sourcePath === linked)
    expect(linkedTree).toBeDefined()
    expect(reply.manifest.activeId).toBe(linkedTree?.id ?? 'no linked tree')
  })
})

describe('the session export after restoring a named or legacy layout', () => {
  const sessionFor = async (args: { restoredCwd: (home: string) => string; moveTo: (restored: string) => string }) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-export-session-')))
    roots.push(root)
    const home = join(root, 'home')
    await mkdir(join(home, 'bootstrap'), { recursive: true })
    const restoredCwd = args.restoredCwd(root)
    await initRepository(restoredCwd)
    const sibling = args.moveTo(restoredCwd)
    await initRepository(sibling)
    const captured: string[] = []
    const direct = createDirectWorkspace({
      driveHome: home,
      destination: join(root, 'unused'),
      restore: async () => ({
        cwd: restoredCwd,
        repository: restoredCwd,
        trees: [{ id: 'main', sourcePath: '/host/repo', path: restoredCwd, branch: 'main', renamedFrom: null }],
      }),
    })
    await writeFile(driveWorkspaceArchivePath({ driveHome: home }), 'generation')
    await direct.apply()
    const app: Pick<ServeApp, 'log' | 'stopWorkspaceProcesses' | 'family'> = {
      log: {
        append: async () => { throw new Error('unused') },
        read: async () => { throw new Error('unused') },
        readOwn: async () => [directoryChanged(sibling)],
        head: async () => { throw new Error('unused') },
        refresh: async () => { throw new Error('unused') },
      },
      stopWorkspaceProcesses: async () => undefined,
      family: undefined,
    }
    const session = createWorkspaceSession({
      direct,
      driveHome: home,
      threadId,
      launchDirectory: () => restoredCwd,
      app,
      capture: async (given) => {
        captured.push(given.cwd)
        return captureWorkspaceArchive(given)
      },
      dormant: false,
      startChildren: async () => undefined,
    })
    return { session, captured, restoredCwd, direct, home, root }
  }

  it('exports the named primary when the parent cwd moves into a sibling', async () => {
    const { session, captured, restoredCwd } = await sessionFor({
      restoredCwd: (root) => join(root, 'atlas', 'workspaces', 'repo'),
      moveTo: (primary) => join(primary, '..', 'other'),
    })

    await session.prepare()

    expect(captured).toEqual([restoredCwd])
  })

  it('exports a legacy single-directory primary the same way', async () => {
    const { session, captured, restoredCwd } = await sessionFor({
      restoredCwd: (root) => join(root, 'atlas', 'workspace'),
      moveTo: (primary) => join(primary, '..', 'other'),
    })

    await session.prepare()

    expect(captured).toEqual([restoredCwd])
  })

  it('reconnects to the saved receipt path without changing it', async () => {
    const { direct, home, restoredCwd, root } = await sessionFor({
      restoredCwd: (root) => join(root, 'atlas', 'workspaces', 'repo'),
      moveTo: (primary) => join(primary, '..', 'other'),
    })

    const reconnected = createDirectWorkspace({ driveHome: home, destination: join(root, 'elsewhere') })
    const result = await reconnected.apply()

    expect(result?.applied).toBe(false)
    expect(result?.restored.cwd).toBe(restoredCwd)
    expect(direct.activeCwd()).toBe(restoredCwd)
  })
})
