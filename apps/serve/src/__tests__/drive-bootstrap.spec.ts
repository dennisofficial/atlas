import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  driveContextArchiveFetcher,
  driveTranscriptArchiveFetcher,
  driveWorkspaceSpecFetcher,
} from '../drive-bootstrap'

const drives: string[] = []
const freshDriveHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-drive-bootstrap-spec-'))
  drives.push(home)
  return home
}

const writeBootstrap = async (args: {
  driveHome: string
  name: string
  content: string | Uint8Array
}): Promise<string> => {
  const dir = join(args.driveHome, 'bootstrap')
  await mkdir(dir, { recursive: true })
  const path = join(dir, args.name)
  await writeFile(path, args.content)
  return path
}

afterEach(() => {
  for (const drive of drives.splice(0, drives.length)) {
    rmSync(drive, { recursive: true, force: true })
  }
})

describe('the workspace spec the laptop left on the drive', () => {
  it('reads and parses bootstrap/workspace-spec.json', async () => {
    const driveHome = freshDriveHome()
    await writeBootstrap({
      driveHome,
      name: 'workspace-spec.json',
      content: JSON.stringify({
        remoteUrl: 'https://github.com/dennisofficial/atlas.git',
        branch: 'dennis/lift-attach',
        commit: 'abc123',
        patch: 'diff --git a/x b/x',
        githubToken: 'gho_drive',
        model: 'anthropic/claude-sonnet-4-5',
        projectDirectory: '/Users/dennis/Developer/atlas',
      }),
    })

    const spec = await driveWorkspaceSpecFetcher({ driveHome })()

    expect(spec.remoteUrl).toBe('https://github.com/dennisofficial/atlas.git')
    expect(spec.githubToken).toBe('gho_drive')
    expect(spec.model).toBe('anthropic/claude-sonnet-4-5')
    expect(spec.projectDirectory).toBe('/Users/dennis/Developer/atlas')
  })

  it('rejects when the laptop never wrote the file, naming where it looked', async () => {
    const driveHome = freshDriveHome()

    await expect(driveWorkspaceSpecFetcher({ driveHome })()).rejects.toThrow(
      join(driveHome, 'bootstrap', 'workspace-spec.json'),
    )
  })

  it('rejects when the file is not a workspace spec', async () => {
    const driveHome = freshDriveHome()
    await writeBootstrap({ driveHome, name: 'workspace-spec.json', content: '{"patch": 42}' })

    await expect(driveWorkspaceSpecFetcher({ driveHome })()).rejects.toThrow()
  })

  it('rejects when the file is not even JSON', async () => {
    const driveHome = freshDriveHome()
    await writeBootstrap({ driveHome, name: 'workspace-spec.json', content: 'not json at all' })

    await expect(driveWorkspaceSpecFetcher({ driveHome })()).rejects.toThrow()
  })
})

describe('the archives the laptop left on the drive', () => {
  it('answers the context archive bytes when the file is there', async () => {
    const driveHome = freshDriveHome()
    const bytes = new Uint8Array([1, 2, 3, 4])
    await writeBootstrap({ driveHome, name: 'context.tar.gz', content: bytes })

    const archive = await driveContextArchiveFetcher({ driveHome })()

    expect(archive).not.toBeNull()
    expect(Array.from(archive ?? [])).toEqual([1, 2, 3, 4])
  })

  it('answers null when there is no context archive on the drive', async () => {
    const driveHome = freshDriveHome()

    await expect(driveContextArchiveFetcher({ driveHome })()).resolves.toBeNull()
  })

  it('answers the transcript archive bytes when the file is there', async () => {
    const driveHome = freshDriveHome()
    const bytes = new Uint8Array([9, 8, 7])
    await writeBootstrap({ driveHome, name: 'transcript.tar.gz', content: bytes })

    const archive = await driveTranscriptArchiveFetcher({ driveHome })()

    expect(archive).not.toBeNull()
    expect(Array.from(archive ?? [])).toEqual([9, 8, 7])
  })

  it('answers null when there is no transcript archive on the drive', async () => {
    const driveHome = freshDriveHome()

    await expect(driveTranscriptArchiveFetcher({ driveHome })()).resolves.toBeNull()
  })
})
