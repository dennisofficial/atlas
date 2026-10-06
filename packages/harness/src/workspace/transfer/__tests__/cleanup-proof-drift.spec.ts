import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { verifySourceCleanupProof, type SourceCleanupProof } from '../cleanup-proof'
import { cleanupScratches, git } from './capture-fixture'
import { addActive, addPeer, createRepository, proofOf, SESSION, type Repository } from './cleanup-proof-fixture'

afterEach(cleanupScratches)

const coveredFamily = async (): Promise<{ repository: Repository; proof: SourceCleanupProof }> => {
  const repository = await createRepository()
  await addActive(repository)
  const proof = await proofOf({ cwd: repository.active })
  expect(proof.retentionReasons).toEqual([])
  return { repository, proof }
}

const refusalOf = async ({ proof }: { proof: SourceCleanupProof }): Promise<string> => {
  const verdict = await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })
  expect(verdict.safe).toBe(false)
  return verdict.reasons.join('\n')
}

describe('registry drift after the proof', () => {
  it('refuses a checkout registered late', async () => {
    const { repository, proof } = await coveredFamily()

    await addPeer(repository)

    expect(await refusalOf({ proof })).toContain('registry-changed')
  })

  it('refuses a covered checkout whose registration was removed', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['worktree', 'remove', '--force', repository.active], cwd: repository.main })

    expect(await refusalOf({ proof })).toContain('registry-changed')
  })

  it('refuses a covered checkout deleted from disk while still registered', async () => {
    const { repository, proof } = await coveredFamily()

    await rm(repository.active, { recursive: true, force: true })

    expect(await refusalOf({ proof })).toContain('inspection-failed')
  })

  it('refuses a covered checkout that was moved', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['worktree', 'move', repository.active, join(repository.scratch, 'moved')], cwd: repository.main })

    expect(await refusalOf({ proof })).toContain('registry-changed')
  })

  it('refuses a registered checkout that became prunable', async () => {
    const { repository, proof } = await coveredFamily()
    await addPeer(repository)
    await rm(repository.peer, { recursive: true, force: true })

    expect(await refusalOf({ proof })).toContain('registry-changed')
  })
})

describe('content drift after the proof', () => {
  it('refuses an edited tracked file in a covered tree', async () => {
    const { repository, proof } = await coveredFamily()

    await writeFile(join(repository.active, 'app.ts'), 'export const one = 2\n')

    expect(await refusalOf({ proof })).toContain('fingerprint-drift')
  })

  it('refuses a new untracked file in main', async () => {
    const { repository, proof } = await coveredFamily()

    await writeFile(join(repository.main, 'late.txt'), 'late\n')

    expect(await refusalOf({ proof })).toContain('fingerprint-drift')
  })

  it('refuses an index-only flag change that leaves work tree content alone', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['update-index', '--chmod=+x', 'app.ts'], cwd: repository.active })
    await git({ args: ['update-index', '--chmod=-x', 'app.ts'], cwd: repository.active })
    await git({ args: ['update-index', '--assume-unchanged', 'app.ts'], cwd: repository.active })

    expect(await refusalOf({ proof })).toContain('fingerprint-drift')
  })

  it('refuses a new commit moving HEAD', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['commit', '--allow-empty', '-m', 'late commit'], cwd: repository.active })

    expect(await refusalOf({ proof })).toContain('fingerprint-drift')
  })

  it('ignores files outside the transfer policy', async () => {
    const { repository, proof } = await coveredFamily()

    await writeFile(join(repository.active, 'ignored.log'), 'ignored\n')
    await writeFile(join(repository.main, 'also-ignored.log'), 'ignored\n')

    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(true)
  })
})

describe('git administration drift after the proof', () => {
  it('refuses a changed repository config', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['config', 'user.signingkey', 'late'], cwd: repository.main })

    expect(await refusalOf({ proof })).toContain('administration-drift')
  })

  it('refuses a new per-worktree ref', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['update-ref', 'refs/worktree/marker', 'HEAD'], cwd: repository.active })

    expect(await refusalOf({ proof })).toContain('administration-drift')
  })

  it('refuses a moved branch of a covered tree', async () => {
    const { repository, proof } = await coveredFamily()

    await git({ args: ['commit', '--allow-empty', '-m', 'late'], cwd: repository.active })

    expect(await refusalOf({ proof })).toContain('administration-drift')
  })

  it('refuses a new per-worktree operation state file', async () => {
    const { repository, proof } = await coveredFamily()
    const gitDir = await git({ args: ['rev-parse', '--absolute-git-dir'], cwd: repository.active })

    await writeFile(join(gitDir, 'MERGE_MSG'), 'half-finished merge\n')

    expect(await refusalOf({ proof })).toContain('administration-drift')
  })
})
