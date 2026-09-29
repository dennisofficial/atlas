import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'bun:test'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'
import { extractContextArchive, memoryDirectoriesFor } from '@dltech/atlas-harness'

import { serveMemoryArchive } from '../serve-session-archive'

const scratch: string[] = []

afterEach(() => {
  for (const dir of scratch.splice(0, scratch.length)) rmSync(dir, { recursive: true, force: true })
})

const stagedHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-memory-archive-'))
  scratch.push(home)
  return home
}

const keysOf = async (archive: Uint8Array | null): Promise<readonly string[]> => {
  if (archive === null) return []
  const extracted = await extractContextArchive({ archive })
  try {
    return extracted.entries.map((entry) => entry.key).sort()
  } finally {
    await extracted.cleanup()
  }
}

describe('the sandbox memory archive', () => {
  it('tars user and project memory under the lift archive’s key layout', async () => {
    const home = stagedHome()
    process.env[ATLAS_HOME_ENV] = home
    const cwd = join(home, 'workspace')
    const projectMemory = memoryDirectoriesFor({
      atlasHome: home,
      repoRoot: cwd,
      identity: 'github.com/comp-ai/atlas',
    }).project

    await mkdir(join(home, 'memory'), { recursive: true })
    await mkdir(projectMemory, { recursive: true })
    await writeFile(join(home, 'memory', 'MEMORY.md'), 'user index')
    await writeFile(join(home, 'memory', 'a-fact.md'), 'remembered')
    await writeFile(join(projectMemory, 'MEMORY.md'), 'project index')
    await writeFile(join(projectMemory, 'a-repo-fact.md'), 'repo remembered')

    const archive = await serveMemoryArchive({ cwd, identity: 'github.com/comp-ai/atlas' })

    expect(await keysOf(archive)).toEqual([
      '.atlas/memory/MEMORY.md',
      '.atlas/memory/a-fact.md',
      'project-memory/MEMORY.md',
      'project-memory/a-repo-fact.md',
    ])
  })

  it('answers null when the sandbox holds no memory at all', async () => {
    const home = stagedHome()
    process.env[ATLAS_HOME_ENV] = home

    const archive = await serveMemoryArchive({ cwd: join(home, 'workspace'), identity: null })

    expect(archive).toBeNull()
  })
})
