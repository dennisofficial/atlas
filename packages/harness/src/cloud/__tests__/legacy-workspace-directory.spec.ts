import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { CLOUD_WORKSPACE_PATH } from '@dltech/atlas-wire'

import {
  legacyWorkspaceDirectoryOf,
  readDirectoryEntries,
  type DirectoryEntries,
} from '../legacy-workspace-directory'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const mount = async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-legacy-workspace-'))
  roots.push(root)
  const driveHome = join(root, 'home')
  await mkdir(driveHome, { recursive: true })
  return { root, driveHome, legacy: join(root, 'workspace') }
}

const withDefaultEntries = ({ entries }: { entries: readonly string[] }): DirectoryEntries =>
  async ({ directory }) =>
    directory === CLOUD_WORKSPACE_PATH ? entries : readDirectoryEntries({ directory })

describe('choosing the cloud workspace directory without a receipt', () => {
  it('keeps an old materialized checkout at its original path', async () => {
    const { driveHome, legacy } = await mount()
    await mkdir(join(legacy, '.git'), { recursive: true })
    await writeFile(join(legacy, '.git', 'atlas-materialized'), '')

    const chosen = await legacyWorkspaceDirectoryOf({
      cwd: CLOUD_WORKSPACE_PATH,
      driveHome,
      entriesOf: withDefaultEntries({ entries: [] }),
    })

    expect(chosen).toBe(legacy)
  })

  it('keeps an old plain directory holding ordinary files', async () => {
    const { driveHome, legacy } = await mount()
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'notes.md'), 'old')

    const chosen = await legacyWorkspaceDirectoryOf({
      cwd: CLOUD_WORKSPACE_PATH,
      driveHome,
      entriesOf: withDefaultEntries({ entries: [] }),
    })

    expect(chosen).toBe(legacy)
  })

  it('prefers a populated configured directory over the legacy one', async () => {
    const { driveHome, legacy } = await mount()
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'notes.md'), 'old')

    const chosen = await legacyWorkspaceDirectoryOf({
      cwd: CLOUD_WORKSPACE_PATH,
      driveHome,
      entriesOf: withDefaultEntries({ entries: ['README.md'] }),
    })

    expect(chosen).toBe(CLOUD_WORKSPACE_PATH)
  })

  it('keeps the new default when the legacy directory is absent', async () => {
    const { driveHome } = await mount()

    const chosen = await legacyWorkspaceDirectoryOf({
      cwd: CLOUD_WORKSPACE_PATH,
      driveHome,
      entriesOf: withDefaultEntries({ entries: [] }),
    })

    expect(chosen).toBe(CLOUD_WORKSPACE_PATH)
  })

  it('keeps the new default when the legacy directory is empty', async () => {
    const { driveHome, legacy } = await mount()
    await mkdir(legacy, { recursive: true })

    const chosen = await legacyWorkspaceDirectoryOf({
      cwd: CLOUD_WORKSPACE_PATH,
      driveHome,
      entriesOf: withDefaultEntries({ entries: [] }),
    })

    expect(chosen).toBe(CLOUD_WORKSPACE_PATH)
  })

  it('never redirects a named or custom directory, even beside a populated legacy one', async () => {
    const { root, driveHome, legacy } = await mount()
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'notes.md'), 'old')
    const asked: string[] = []

    for (const cwd of ['/atlas/workspaces/atlas', join(root, 'custom'), '/atlas/workspace']) {
      const chosen = await legacyWorkspaceDirectoryOf({
        cwd,
        driveHome,
        entriesOf: async ({ directory }) => {
          asked.push(directory)
          return []
        },
      })
      expect(chosen).toBe(cwd)
    }

    expect(asked).toEqual([])
  })

  it('throws on a read failure that is not a missing directory', async () => {
    const { driveHome, legacy } = await mount()
    await writeFile(legacy, 'a file where the directory should be')

    await expect(
      legacyWorkspaceDirectoryOf({
        cwd: CLOUD_WORKSPACE_PATH,
        driveHome,
        entriesOf: withDefaultEntries({ entries: [] }),
      }),
    ).rejects.toThrow()
  })

  it('reads a missing directory as empty and a populated one by name', async () => {
    const { root, legacy } = await mount()
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'a.txt'), '')

    expect(await readDirectoryEntries({ directory: join(root, 'absent') })).toEqual([])
    expect(await readDirectoryEntries({ directory: legacy })).toEqual(['a.txt'])
  })
})
