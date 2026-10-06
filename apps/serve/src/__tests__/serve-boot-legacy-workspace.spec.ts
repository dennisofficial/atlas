import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import {
  CLOUD_WORKSPACE_PATH,
  toThreadId,
} from '@dltech/atlas-core'
import {
  readDirectoryEntries,
  type DirectoryEntries,
  type RestoredWorkspace,
} from '@dltech/atlas-harness'

import { EWorkspaceState, type EnsureWorkspace } from '../materialize-workspace'
import { bootServeFiles } from '../serve-boot'

const threadId = toThreadId('thread-legacy-workspace')
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const restoredAt = (cwd: string): RestoredWorkspace => ({
  cwd,
  repository: cwd,
  trees: [{ id: 'main', sourcePath: '/host/repo', path: cwd, branch: null, renamedFrom: null }],
})

const seedDrive = async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-legacy-boot-'))
  roots.push(root)
  const driveHome = join(root, 'home')
  const legacy = join(root, 'workspace')
  await mkdir(join(driveHome, 'bootstrap'), { recursive: true })
  await mkdir(join(legacy, '.git'), { recursive: true })
  await writeFile(join(legacy, '.git', 'atlas-materialized'), '')
  await writeFile(join(legacy, 'work.txt'), 'old edits')
  return { root, driveHome, legacy }
}

const directoryEntries: DirectoryEntries = async ({ directory }) =>
  directory === CLOUD_WORKSPACE_PATH ? [] : readDirectoryEntries({ directory })

const boot = async (args: {
  driveHome: string
  cwd?: string
  restoreTo?: string
  directoryEntries?: DirectoryEntries
}) => {
  const ensured: string[] = []
  const ensureWorkspace: EnsureWorkspace = async ({ cwd }) => {
    ensured.push(cwd)
    return { state: EWorkspaceState.Present }
  }
  const booted = await bootServeFiles({
    env: {},
    threadId,
    cwd: args.cwd ?? CLOUD_WORKSPACE_PATH,
    driveHome: args.driveHome,
    log: () => undefined,
    ensureWorkspace,
    restoreWorkspace:
      args.restoreTo === undefined ? undefined : async () => restoredAt(args.restoreTo ?? ''),
    fetchTranscriptArchive: async () => null,
    directoryEntries: args.directoryEntries ?? directoryEntries,
  })
  return { booted, ensured }
}

describe('cold boot of a drive that predates named workspaces', () => {
  it('keeps the old checkout directory and never re-materializes over it', async () => {
    const { driveHome, legacy } = await seedDrive()

    const { booted, ensured } = await boot({ driveHome })

    expect(booted.directBoot.kind).toBe('none')
    expect(booted.activeCwd).toBe(legacy)
    expect(ensured).toEqual([legacy])
    expect(await readFile(join(legacy, 'work.txt'), 'utf8')).toBe('old edits')
    expect((await readdir(legacy)).sort()).toEqual(['.git', 'work.txt'])
  })

  it('leaves an explicitly named workspace where it was configured', async () => {
    const { root, driveHome } = await seedDrive()
    const named = join(root, 'workspaces', 'atlas')

    const { booted, ensured } = await boot({ driveHome, cwd: named })

    expect(booted.activeCwd).toBe(named)
    expect(ensured).toEqual([named])
  })

  it('prefers a direct receipt over a populated legacy directory', async () => {
    const { root, driveHome, legacy } = await seedDrive()
    const named = join(root, 'workspaces', 'atlas')
    await writeFile(join(driveHome, 'bootstrap', 'workspace.tar.gz'), 'generation')

    const { booted, ensured } = await boot({ driveHome, restoreTo: named })

    expect(booted.directBoot.kind).toBe('ready')
    expect(booted.activeCwd).toBe(named)
    expect(ensured).toEqual([])

    const reconnected = await boot({ driveHome })

    expect(reconnected.booted.activeCwd).toBe(named)
    expect(reconnected.ensured).toEqual([])
    expect(await readFile(join(legacy, 'work.txt'), 'utf8')).toBe('old edits')
  })

  it('keeps a saved legacy receipt path on reconnect', async () => {
    const { driveHome, legacy } = await seedDrive()
    await writeFile(join(driveHome, 'bootstrap', 'workspace.tar.gz'), 'generation')
    await boot({ driveHome, restoreTo: legacy })

    const { booted, ensured } = await boot({ driveHome })

    expect(booted.activeCwd).toBe(legacy)
    expect(ensured).toEqual([])
  })

  it('reports a corrupt receipt as failed instead of falling back to the legacy directory', async () => {
    const { driveHome } = await seedDrive()
    await writeFile(join(driveHome, 'bootstrap', 'workspace-applied.json'), '{not json')

    const { booted, ensured } = await boot({ driveHome })

    expect(booted.directBoot.kind).toBe('failed')
    expect(booted.workspace.state).toBe(EWorkspaceState.Failed)
    expect(booted.activeCwd).toBe(CLOUD_WORKSPACE_PATH)
    expect(ensured).toEqual([])
  })
})
