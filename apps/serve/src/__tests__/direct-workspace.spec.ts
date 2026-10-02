import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { EWorkspaceRestoreMode, type RestoredWorkspace } from '@dltech/atlas-harness'

import { createDirectWorkspace } from '../direct-workspace'

const roots: string[] = []

const freshHome = async (): Promise<{ home: string; archive: string; destination: string }> => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-direct-workspace-'))
  roots.push(root)
  await mkdir(join(root, 'bootstrap'), { recursive: true })
  return {
    home: root,
    archive: join(root, 'bootstrap', 'workspace.tar.gz'),
    destination: join(root, 'workspace'),
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const restoredAt = (cwd: string): RestoredWorkspace => ({
  cwd,
  repository: cwd,
  trees: [{ id: 'main', sourcePath: '/host/repo', path: cwd, branch: 'main', renamedFrom: null }],
})

describe('the direct workspace generation', () => {
  it('restores a new archive once, in cloud mode, and keeps its receipt', async () => {
    const { home, archive, destination } = await freshHome()
    await writeFile(archive, 'generation-one')
    const modes: unknown[] = []
    const direct = createDirectWorkspace({
      driveHome: home,
      destination,
      restore: async (given) => {
        modes.push(given.mode)
        return restoredAt(join(destination, 'repo'))
      },
    })

    const boot = await direct.boot()

    expect(boot.kind === 'ready' && boot.result.applied).toBe(true)
    expect(modes).toEqual([EWorkspaceRestoreMode.Cloud])
    expect(direct.activeCwd()).toBe(join(destination, 'repo'))
    expect(existsSync(archive)).toBe(false)
    const receipt = await direct.receipt()
    expect(receipt?.activated).toBe(false)
    expect(receipt?.arrivalPending).toBe(true)
  })

  it('returns the active cwd for a matching receipt without restoring over cloud edits', async () => {
    const { home, archive, destination } = await freshHome()
    let restores = 0
    const restore = async () => {
      restores += 1
      return restoredAt(join(destination, 'repo'))
    }
    await writeFile(archive, 'same-bytes')
    await createDirectWorkspace({ driveHome: home, destination, restore }).boot()
    await mkdir(join(destination, 'repo'), { recursive: true })
    await writeFile(join(destination, 'repo', 'edited-in-cloud.txt'), 'keep me')

    await writeFile(archive, 'same-bytes')
    const again = await createDirectWorkspace({ driveHome: home, destination, restore }).apply()

    expect(restores).toBe(1)
    expect(again?.applied).toBe(false)
    expect(again?.restored.cwd).toBe(join(destination, 'repo'))
    expect(await readFile(join(destination, 'repo', 'edited-in-cloud.txt'), 'utf8')).toBe('keep me')
    expect(existsSync(archive)).toBe(false)
  })

  it('restores a different archive as a new generation', async () => {
    const { home, archive, destination } = await freshHome()
    let restores = 0
    const direct = createDirectWorkspace({
      driveHome: home,
      destination,
      restore: async () => {
        restores += 1
        return restoredAt(join(destination, `repo-${restores}`))
      },
    })
    await writeFile(archive, 'one')
    await direct.apply()
    await direct.markActivated()
    await writeFile(archive, 'two')

    const second = await direct.apply()

    expect(second?.applied).toBe(true)
    expect(second?.activated).toBe(false)
    expect(second?.restored.cwd).toBe(join(destination, 'repo-2'))
  })

  it('answers nothing when no archive was ever supplied', async () => {
    const { home, destination } = await freshHome()

    const boot = await createDirectWorkspace({ driveHome: home, destination }).boot()

    expect(boot).toEqual({ kind: 'none' })
  })

  it('reports a failed restore without recording a receipt', async () => {
    const { home, archive, destination } = await freshHome()
    await writeFile(archive, 'broken')
    const direct = createDirectWorkspace({
      driveHome: home,
      destination,
      restore: async () => {
        throw new Error('the archive did not verify')
      },
    })

    const boot = await direct.boot()

    expect(boot).toEqual({ kind: 'failed', reason: 'the archive did not verify' })
    expect(await direct.receipt()).toBeNull()
  })
})
