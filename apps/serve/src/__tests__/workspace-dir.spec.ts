import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  readRecordedWorkspaceDir,
  resolveWorkspaceDir,
  workspaceDirRecordFile,
  writeRecordedWorkspaceDir,
} from '../workspace-dir'
import type { WorkspaceSpec } from '../workspace-spec'

const homes: string[] = []

const home = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-workspace-dir-'))
  homes.push(dir)
  return dir
}

afterEach(() => {
  while (homes.length > 0) {
    const dir = homes.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const specWith = (remoteUrl: string | null): WorkspaceSpec => ({
  remoteUrl,
  githubToken: null,
  model: null,
})

describe('readRecordedWorkspaceDir', () => {
  it('answers null when no record exists', async () => {
    expect(await readRecordedWorkspaceDir({ atlasHome: home() })).toBeNull()
  })

  it('round-trips a written record', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/atlas' })
    expect(await readRecordedWorkspaceDir({ atlasHome })).toBe('/atlas/workspaces/atlas')
  })

  it('answers null for a corrupt record', async () => {
    const atlasHome = home()
    const file = workspaceDirRecordFile({ atlasHome })
    await mkdir(join(atlasHome, 'operational'), { recursive: true })
    await writeFile(file, 'not json', 'utf8')
    expect(await readRecordedWorkspaceDir({ atlasHome })).toBeNull()
  })
})

describe('resolveWorkspaceDir', () => {
  it('names the workspace after the repo in the spec remote', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => specWith('https://github.com/dennisofficial/atlas'),
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })

  it('reads the repo name from an ssh remote too', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => specWith('git@github.com:dennisofficial/atlas.git'),
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
  })

  it('lands a no-remote thread in the launcher cwd', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => specWith(null),
    })
    expect(dir).toBe('/atlas/workspaces/workspace')
  })

  it('falls back to the launcher cwd when the spec is unreadable', async () => {
    const dir = await resolveWorkspaceDir({
      atlasHome: home(),
      fetchSpec: async () => {
        throw new Error('no spec')
      },
    })
    expect(dir).toBe('/atlas/workspaces/workspace')
  })

  it('reuses the recorded dir on resume without consulting the spec', async () => {
    const atlasHome = home()
    await writeRecordedWorkspaceDir({ atlasHome, workspaceDir: '/atlas/workspaces/atlas' })
    let specReads = 0
    const dir = await resolveWorkspaceDir({
      atlasHome,
      fetchSpec: async () => {
        specReads += 1
        return specWith('https://github.com/dennisofficial/renamed')
      },
    })
    expect(dir).toBe('/atlas/workspaces/atlas')
    expect(specReads).toBe(0)
  })
})
