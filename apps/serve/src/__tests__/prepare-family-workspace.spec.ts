import { afterEach, describe, expect, it } from 'bun:test'
import { readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, familyFixture, removeFamilyFixtures, SOURCE_SESSION, type FamilyFixture } from './family-cleanup-fixture'

afterEach(removeFamilyFixtures)

const ownedFamily = async (fx: FamilyFixture) => {
  const first = await fx.linked('first')
  await fx.enter({ threadId: fx.rootThread, path: first })
  return { first, second: fx.childCheckout }
}

const unrelated = async (fx: FamilyFixture): Promise<string> => fx.linked('unrelated')

const cleanupOf = async (fx: FamilyFixture) => {
  const reply = await fx.session.prepare()
  if (reply.cleanup === undefined) throw new Error('the family export carried no cleanup candidate')
  return { reply, cleanup: reply.cleanup }
}

const verdictOf = async (fx: FamilyFixture, generation: string) => {
  const frame = await fx.confirm(generation)
  return { ok: frame.ok, data: frame.data as { safe?: boolean; reasons?: string[]; sourceSessionId?: string; message?: string } }
}

describe('a family export beside an unrelated registered checkout', () => {
  it('captures the family but refuses cleanup, and the refusal is sticky', async () => {
    const fx = await familyFixture()
    const { first, second } = await ownedFamily(fx)
    const other = await unrelated(fx)

    const { reply, cleanup } = await cleanupOf(fx)

    expect(reply.manifest.trees.map((tree) => tree.sourcePath)).toEqual(expect.arrayContaining([fx.repo, first, second]))
    expect(reply.manifest.trees.map((tree) => tree.sourcePath)).not.toContain(other)
    expect(reply.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(cleanup.safe).toBe(false)
    expect(cleanup.sourceSessionId).toBe(SOURCE_SESSION)
    expect(cleanup.reasons.join('\n')).toContain(other)

    expect((await verdictOf(fx, cleanup.generation)).data.safe).toBe(false)
    await git({ cwd: fx.repo, args: ['worktree', 'remove', '--force', other] })
    const after = await verdictOf(fx, cleanup.generation)
    expect(after.ok).toBe(true)
    expect(after.data.safe).toBe(false)
    expect(after.data.sourceSessionId).toBe(SOURCE_SESSION)
  })
})

describe('a complete family export', () => {
  it('is a safe candidate and confirms safe while nothing changes', async () => {
    const fx = await familyFixture()
    const { first, second } = await ownedFamily(fx)

    const { reply, cleanup } = await cleanupOf(fx)

    expect(reply.manifest.trees.map((tree) => tree.sourcePath).sort()).toEqual([fx.repo, first, second].sort())
    expect(cleanup).toEqual({ generation: expect.any(String), sourceSessionId: SOURCE_SESSION, safe: true, reasons: [] })
    expect(await verdictOf(fx, cleanup.generation)).toEqual({
      ok: true,
      data: { safe: true, reasons: [], sourceSessionId: SOURCE_SESSION },
    })
  })

  it('refuses a checkout registered after the export', async () => {
    const fx = await familyFixture()
    await ownedFamily(fx)
    const { cleanup } = await cleanupOf(fx)

    await unrelated(fx)

    const verdict = await verdictOf(fx, cleanup.generation)
    expect(verdict.data.safe).toBe(false)
    expect(verdict.data.reasons?.join('\n')).toContain('registry-changed')
  })

  it('refuses a content write after the export', async () => {
    const fx = await familyFixture()
    const { first } = await ownedFamily(fx)
    const { cleanup } = await cleanupOf(fx)

    await writeFile(join(first, 'late.txt'), 'late\n')

    const verdict = await verdictOf(fx, cleanup.generation)
    expect(verdict.data.safe).toBe(false)
    expect(verdict.data.reasons?.join('\n')).toContain('fingerprint-drift')
  })

  it('refuses a git administration write after the export', async () => {
    const fx = await familyFixture()
    const { second } = await ownedFamily(fx)
    const { cleanup } = await cleanupOf(fx)

    await git({ cwd: second, args: ['update-ref', 'refs/worktree/marker', 'HEAD'] })

    const verdict = await verdictOf(fx, cleanup.generation)
    expect(verdict.data.safe).toBe(false)
    expect(verdict.data.reasons?.join('\n')).toContain('administration-drift')
  })

  it('refuses an owned checkout deleted after the export', async () => {
    const fx = await familyFixture()
    const { first } = await ownedFamily(fx)
    const { cleanup } = await cleanupOf(fx)

    await rm(first, { recursive: true, force: true })

    expect((await verdictOf(fx, cleanup.generation)).data.safe).toBe(false)
  })

  it('leaves the export files in place and removes nothing from the source', async () => {
    const fx = await familyFixture()
    const { first } = await ownedFamily(fx)
    const { reply, cleanup } = await cleanupOf(fx)

    await verdictOf(fx, cleanup.generation)

    expect((await readdir(join(fx.home, 'exports'))).some((name) => reply.path.endsWith(name))).toBe(true)
    expect(await git({ cwd: first, args: ['status', '--porcelain'] })).toBe('')
  })
})

describe('confirmation fences', () => {
  it('retains when the runtime has no source session identity', async () => {
    const fx = await familyFixture({ sourceSessionId: undefined })
    await ownedFamily(fx)

    const { cleanup } = await cleanupOf(fx)

    expect(cleanup.safe).toBe(false)
    expect(cleanup.reasons.join('\n')).toContain('no provider-session identity')
    expect((await verdictOf(fx, cleanup.generation)).data.safe).toBe(false)
  })

  it('answers false for a generation that was never prepared, as after a restart', async () => {
    const fx = await familyFixture()
    await ownedFamily(fx)

    const verdict = await verdictOf(fx, '/exports/workspace-unknown.tar.gz')

    expect(verdict.ok).toBe(true)
    expect(verdict.data.safe).toBe(false)
    expect(verdict.data.reasons?.join('\n')).toContain('no matching prepared cleanup generation')
  })

  it('refuses confirmation while a turn is running', async () => {
    const fx = await familyFixture()
    await ownedFamily(fx)
    const { cleanup } = await cleanupOf(fx)

    fx.setBusy(true)

    const verdict = await verdictOf(fx, cleanup.generation)
    expect(verdict.ok).toBe(false)
    expect(verdict.data.message).toContain('a turn is running')
  })

  it('does not trust an older generation once a newer export replaced it', async () => {
    const fx = await familyFixture()
    await ownedFamily(fx)
    const first = (await cleanupOf(fx)).cleanup
    const second = (await cleanupOf(fx)).cleanup

    expect(second.generation).not.toBe(first.generation)
    expect((await verdictOf(fx, first.generation)).data.safe).toBe(false)
    expect((await verdictOf(fx, second.generation)).data.safe).toBe(true)
  })
})
