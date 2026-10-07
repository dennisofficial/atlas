import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'bun:test'

import { captureSourceCleanupProof, verifySourceCleanupProof } from '../cleanup-proof'
import { cleanupScratches, createScratch, git } from './capture-fixture'
import { addActive, addPeer, createRepository, GENERATION, proofOf, SESSION } from './cleanup-proof-fixture'

afterEach(cleanupScratches)

describe('capturing a source cleanup proof', () => {
  it('is safe for a plain directory and stays safe while its content is unchanged', async () => {
    const scratch = await createScratch()
    await writeFile(join(scratch, 'note.txt'), 'plain\n')

    const proof = await proofOf({ cwd: scratch })

    expect(proof.retentionReasons).toEqual([])
    expect(proof.registryRoots).toEqual([])
    expect(proof.adminDigest).toBeNull()
    expect(await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).toEqual({ safe: true, reasons: [] })
  })

  it('is safe for main alone and carries generation, session, manifest and canonical roots', async () => {
    const { main } = await createRepository()

    const proof = await proofOf({ cwd: main })

    expect(proof.generation).toBe(GENERATION)
    expect(proof.sessionId).toBe(SESSION)
    expect(proof.cwd).toBe(await realpath(main))
    expect(proof.registryRoots).toEqual([await realpath(main)])
    expect(proof.manifest.trees.map((tree) => tree.sourcePath)).toEqual([await realpath(main)])
    expect(proof.adminDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).toEqual({ safe: true, reasons: [] })
    expect(proof.generation).toBe(GENERATION)
  })

  it('is safe for main plus the active worktree when both are covered', async () => {
    const repository = await createRepository()
    await addActive(repository)

    const proof = await proofOf({ cwd: repository.active })

    expect(proof.manifest.trees).toHaveLength(2)
    expect(proof.registryRoots).toHaveLength(2)
    expect(proof.retentionReasons).toEqual([])
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(true)
  })

  it('does not mutate the source or any registered checkout', async () => {
    const repository = await createRepository()
    await addActive(repository)
    const before = await git({ args: ['status', '--porcelain=v2', '--branch'], cwd: repository.active })

    const proof = await proofOf({ cwd: repository.active })
    await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })

    expect(await git({ args: ['status', '--porcelain=v2', '--branch'], cwd: repository.active })).toBe(before)
    expect(await readFile(join(repository.active, 'app.ts'), 'utf8')).toBe('export const one = 1\n')
  })
})

describe('unrelated registered checkouts', () => {
  it('retain a clean unrelated peer even though the capture itself succeeded', async () => {
    const repository = await createRepository()
    await addActive(repository)
    await addPeer(repository)

    const proof = await proofOf({ cwd: repository.active })
    const verdict = await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })

    expect(proof.manifest.trees).toHaveLength(2)
    expect(proof.retentionReasons.join('\n')).toContain(await realpath(repository.peer))
    expect(verdict.safe).toBe(false)
    expect(verdict.reasons).toEqual(proof.retentionReasons)
  })

  it('retain a dirty unpublished peer and leave its work intact', async () => {
    const repository = await createRepository()
    await addPeer(repository)
    await writeFile(join(repository.peer, 'work.ts'), 'export const work = 1\n')
    await git({ args: ['add', 'work.ts'], cwd: repository.peer })
    await git({ args: ['commit', '-m', 'unpublished'], cwd: repository.peer })
    await writeFile(join(repository.peer, 'dirty.txt'), 'dirty\n')

    const proof = await proofOf({ cwd: repository.main })

    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(false)
    expect(await readFile(join(repository.peer, 'dirty.txt'), 'utf8')).toBe('dirty\n')
  })

  it('retain a peer outside the main checkout directory', async () => {
    const repository = await createRepository()
    const outside = join(repository.scratch, 'outside')
    await git({ args: ['worktree', 'add', outside, '-b', 'outside'], cwd: repository.main })

    const proof = await proofOf({ cwd: repository.main })

    expect(proof.retentionReasons.join('\n')).toContain(await realpath(outside))
    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(false)
  })

  it('stay retained after the unrelated checkout is removed', async () => {
    const repository = await createRepository()
    await addPeer(repository)
    const proof = await proofOf({ cwd: repository.main })

    await git({ args: ['worktree', 'remove', '--force', repository.peer], cwd: repository.main })

    expect((await verifySourceCleanupProof({ proof, sourceSessionId: SESSION })).safe).toBe(false)
  })

  it('stay retained when a nested checkout is the only omitted root', async () => {
    const repository = await createRepository()
    await mkdir(join(repository.main, 'pkg'), { recursive: true })
    const nested = join(repository.main, 'pkg', 'nested')
    await git({ args: ['worktree', 'add', nested, '-b', 'nested'], cwd: repository.main })

    const proof = await proofOf({ cwd: repository.main })

    expect(proof.retentionReasons.join('\n')).toContain(await realpath(nested))
  })
})

describe('session fencing and unusable input', () => {
  it('refuses a different source session without touching the repository', async () => {
    const { main } = await createRepository()
    const proof = await proofOf({ cwd: main })

    const verdict = await verifySourceCleanupProof({ proof, sourceSessionId: 'session-other' })

    expect(verdict.safe).toBe(false)
    expect(verdict.reasons.join('\n')).toContain('session-changed')
  })

  it('retains when a manifest root cannot be resolved', async () => {
    const { main } = await createRepository()
    const proof = await proofOf({ cwd: main })
    const broken = {
      ...proof.manifest,
      trees: proof.manifest.trees.map((tree) => ({ ...tree, sourcePath: join(main, 'vanished') })),
    }

    const retained = await captureSourceCleanupProof({
      cwd: main,
      manifest: broken,
      generation: GENERATION,
      sourceSessionId: SESSION,
    })

    expect(retained.retentionReasons.join('\n')).toContain('inspection-failed')
    expect((await verifySourceCleanupProof({ proof: retained, sourceSessionId: SESSION })).safe).toBe(false)
  })

  it('retains when the source directory cannot be inspected', async () => {
    const { main } = await createRepository()
    const proof = await proofOf({ cwd: main })

    const retained = await captureSourceCleanupProof({
      cwd: join(main, 'missing'),
      manifest: proof.manifest,
      generation: GENERATION,
      sourceSessionId: SESSION,
    })

    expect(retained.retentionReasons.join('\n')).toContain('inspection-failed')
  })

  it('retains when the archived fingerprint does not match the source', async () => {
    const { main } = await createRepository()
    const proof = await proofOf({ cwd: main })
    const stale = { ...proof.manifest, trees: proof.manifest.trees.map((tree) => ({ ...tree, fingerprint: 'stale' })) }

    const retained = await captureSourceCleanupProof({ cwd: main, manifest: stale, generation: GENERATION, sourceSessionId: SESSION })

    expect(retained.retentionReasons.join('\n')).toContain('fingerprint-drift')
  })

  it('retains when one root is claimed by two manifest trees', async () => {
    const { main } = await createRepository()
    const proof = await proofOf({ cwd: main })
    const [tree] = proof.manifest.trees
    if (tree === undefined) throw new Error('manifest has no tree')
    const doubled = { ...proof.manifest, trees: [tree, { ...tree, id: 'twin', isMain: false }] }

    const retained = await captureSourceCleanupProof({ cwd: main, manifest: doubled, generation: GENERATION, sourceSessionId: SESSION })

    expect(retained.retentionReasons.join('\n')).toContain('ambiguous-root')
  })
})
