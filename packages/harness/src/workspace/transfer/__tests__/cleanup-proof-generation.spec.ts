import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'
import { workspaceManifestWireSchema } from '@dltech/atlas-wire'

import { digestGitAdmin } from '../capture-admin'
import { captureSourceCleanupProof, verifySourceCleanupProof } from '../cleanup-proof'
import type { WorkspaceManifest } from '../manifest'
import { capture, cleanupScratches, createScratch, git, walk } from './capture-fixture'
import { addActive, createRepository, GENERATION, SESSION, type Repository } from './cleanup-proof-fixture'

afterEach(cleanupScratches)

const proofFor = ({ cwd, manifest }: { cwd: string; manifest: WorkspaceManifest }) =>
  captureSourceCleanupProof({ cwd, manifest, generation: GENERATION, sourceSessionId: SESSION })

const family = async (): Promise<{ repository: Repository; manifest: WorkspaceManifest; extracted: string }> => {
  const repository = await createRepository()
  await addActive(repository)
  const { manifest, extracted } = await capture({ cwd: repository.active })
  return { repository, manifest, extracted }
}

const reasonsOf = async ({ cwd, manifest }: { cwd: string; manifest: WorkspaceManifest }): Promise<string> =>
  (await proofFor({ cwd, manifest })).retentionReasons.join('\n')

const archiveMentions = async ({ root, text }: { root: string; text: string }): Promise<boolean> => {
  for (const path of await walk(root)) {
    const bytes = await readFile(join(root, path)).catch(() => null)
    if (bytes !== null && bytes.toString('utf8').includes(text)) return true
  }
  return false
}

describe('the capture generation of the git administration', () => {
  it('records the observed administration digest in every git capture and null for a plain directory', async () => {
    const { repository, manifest } = await family()
    const trees = manifest.trees.map((tree) => ({ sourcePath: tree.sourcePath, branch: tree.branch }))

    expect(manifest.administrationFingerprint).toBe(await digestGitAdmin({ trees }))
    expect(manifest.administrationFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(repository.active).toBeDefined()

    const plain = await createScratch()
    await writeFile(join(plain, 'note.txt'), 'plain\n')
    expect((await capture({ cwd: plain })).manifest.administrationFingerprint).toBeNull()
  })

  it('survives the wire schema', async () => {
    const { manifest } = await family()

    expect(workspaceManifestWireSchema.parse(manifest).administrationFingerprint).toBe(manifest.administrationFingerprint)
  })

  it('is safe against the captured digest and stays tied to it after the proof', async () => {
    const { repository, manifest } = await family()

    const proof = await proofFor({ cwd: repository.active, manifest })

    expect(proof.retentionReasons).toEqual([])
    expect(proof.adminDigest).toBe(manifest.administrationFingerprint ?? null)
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(true)
    await git({ args: ['update-ref', 'refs/worktree/after', 'HEAD'], cwd: repository.active })
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(false)
  })
})

describe('administration written between the archive and the proof', () => {
  it('retains a private ref created after capture, which the restored archive never carried', async () => {
    const { repository, manifest, extracted } = await family()
    await git({ args: ['update-ref', 'refs/worktree/dangling', 'HEAD'], cwd: repository.active })

    const proof = await proofFor({ cwd: repository.active, manifest })

    expect(proof.retentionReasons.join('\n')).toContain('administration-baseline-mismatch')
    expect(await archiveMentions({ root: extracted, text: 'refs/worktree/dangling' })).toBe(false)
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(false)
  })

  it('retains a commit that moved a covered branch after capture', async () => {
    const { repository, manifest } = await family()
    await git({ args: ['commit', '--allow-empty', '-m', 'late'], cwd: repository.active })

    expect(await reasonsOf({ cwd: repository.active, manifest })).toContain('administration-baseline-mismatch')
  })

  it('retains a config change after capture', async () => {
    const { repository, manifest } = await family()
    await git({ args: ['config', 'user.signingkey', 'late'], cwd: repository.main })

    expect(await reasonsOf({ cwd: repository.active, manifest })).toContain('administration-baseline-mismatch')
  })

  it('retains a per-worktree operation state file written after capture', async () => {
    const { repository, manifest } = await family()
    const gitDir = await git({ args: ['rev-parse', '--absolute-git-dir'], cwd: repository.active })
    await writeFile(join(gitDir, 'MERGE_MSG'), 'half-finished\n')

    expect(await reasonsOf({ cwd: repository.active, manifest })).toContain('administration-baseline-mismatch')
  })

  it('retains a reflog entry added after capture', async () => {
    const { repository, manifest } = await family()
    await git({ args: ['reflog', 'expire', '--expire=now', '--all'], cwd: repository.main })
    const entries = async (): Promise<string[]> => readdir(join(repository.main, '.git', 'logs')).catch(() => [])
    const before = await entries()

    await git({ args: ['commit', '--allow-empty', '-m', 'reflog write'], cwd: repository.main })

    expect(before).toBeDefined()
    expect(await reasonsOf({ cwd: repository.active, manifest })).toContain('administration-baseline-mismatch')
  })
})

describe('manifests without a captured administration digest', () => {
  it('retains a git manifest that omits the field, as an old export cannot prove its generation', async () => {
    const { repository, manifest } = await family()
    const { administrationFingerprint: _omitted, ...legacy } = manifest

    const proof = await proofFor({ cwd: repository.active, manifest: legacy })

    expect(proof.retentionReasons.join('\n')).toContain('administration-baseline-missing')
    expect(proof.adminDigest).toBeNull()
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(false)
  })

  it('retains a git manifest whose digest was explicitly nulled', async () => {
    const { repository, manifest } = await family()

    expect(await reasonsOf({ cwd: repository.active, manifest: { ...manifest, administrationFingerprint: null } })).toContain(
      'administration-baseline-missing',
    )
  })

  it('keeps a plain directory safe without any administration digest', async () => {
    const plain = await createScratch()
    await writeFile(join(plain, 'note.txt'), 'plain\n')
    const { manifest } = await capture({ cwd: plain })
    const { administrationFingerprint: _omitted, ...legacy } = manifest

    expect((await proofFor({ cwd: plain, manifest: legacy })).retentionReasons).toEqual([])
  })
})
