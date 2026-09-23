import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CLOUD_WORKSPACE_PATH } from '@dltech/atlas-core'

import { mergePublishedWorkspace } from '../merge-published'
import { runGit } from '../run-git'
import {
  CARRIED,
  LIFTED,
  commitAll,
  git,
  headOf,
  publishFrom,
  scenario,
  staged,
} from './merge-fixture'

describe('mergePublishedWorkspace', () => {
  it('lands cloud work as uncommitted local changes and deletes the scratch ref', async () => {
    const { remote, local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(await headOf(local)).toBe(lifted)
    expect(await staged(local)).toBe('')
    expect((await git(local, ['status', '--porcelain'])).stdout).not.toBe('')
    expect((await runGit({ args: ['ls-remote', '--', remote], cwd: local })).stdout).not.toContain(
      ref,
    )
  })

  it('merges a cloud edit appended after a lifted uncommitted line without conflicting', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
  })

  it('falls back to the recorded baseTree when the publish carried no wrapper parent', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
  })

  it('survives the agent rewriting history in the sandbox, merging by tree', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    await git(cloud, ['add', '-A'])
    await git(cloud, [
      '-c',
      'user.name=Spec',
      '-c',
      'user.email=spec@example.com',
      'commit',
      '--amend',
      '-m',
      'a rewritten root the recorded baseline is no part of',
    ])
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(CARRIED)
    expect(await headOf(local)).toBe(lifted)
  })

  it('stays clean when the lifted work was committed locally after the lift', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    await commitAll(local, 'operator commits the lifted work')
    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
  })

  it('leaves conflict markers in the tree and reports the files when both sides moved', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(local, 'app.ts'), 'local rewrite\nline two\nline three\nlifted line\n')
    writeFileSync(join(cloud, 'app.ts'), 'cloud rewrite\nline two\nline three\nlifted line\n')
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual(['app.ts'])
    const content = readFileSync(join(local, 'app.ts'), 'utf8')
    expect(content).toContain('<<<<<<<')
    expect(content).toContain('local rewrite')
    expect(content).toContain('cloud rewrite')
    expect(await headOf(local)).toBe(lifted)
    expect(await staged(local)).toBe('')
  })

  it('keeps commits the operator made locally after the lift', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(local, 'local-commit.txt'), 'committed while away\n')
    const localTip = await commitAll(local, 'operator work after the lift')
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(await headOf(local)).toBe(localTip)
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(readFileSync(join(local, 'local-commit.txt'), 'utf8')).toBe('committed while away\n')
  })

  it('merges against the baseline commit’s tree when no baseTree rides down from an old serve', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-merge-legacy-'))
    const remote = join(root, 'remote.git')
    const local = join(root, 'local')
    const cloud = join(root, 'cloud')
    await git(root, ['init', '--bare', '--initial-branch=main', remote])
    await git(root, ['clone', '--', remote, cloud])
    writeFileSync(join(cloud, 'app.ts'), LIFTED)
    await commitAll(cloud, 'lifted commit')
    await git(cloud, ['push', 'origin', 'HEAD:main'])
    writeFileSync(join(cloud, 'app.ts'), CARRIED)
    const baseline = await commitAll(cloud, 'atlas: lifted workspace baseline')
    await git(root, ['clone', '--', remote, local])
    writeFileSync(join(local, 'app.ts'), CARRIED)

    writeFileSync(join(cloud, 'app.ts'), `${CARRIED}cloud line\n`)
    const ref = await publishFrom(cloud)

    const merged = await mergePublishedWorkspace({ cwd: local, ref, base: baseline })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(`${CARRIED}cloud line\n`)
  })

  it('refuses before touching anything when the two histories share no commit', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    const orphan = mkdtempSync(join(tmpdir(), 'atlas-merge-orphan-'))
    await git(orphan, ['init', '--initial-branch=main'])
    writeFileSync(join(orphan, 'elsewhere.txt'), 'a different history\n')
    await commitAll(orphan, 'unrelated root')
    const unrelatedHead = await headOf(orphan)
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)
    await git(
      orphan,
      ['remote', 'add', 'origin', (await git(local, ['remote', 'get-url', 'origin'])).stdout.trim()],
    )

    const failure = await mergePublishedWorkspace({
      cwd: orphan,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    }).catch((error: unknown) => error)

    if (!(failure instanceof Error)) throw new Error('expected the merge to refuse')
    expect(failure.message).toContain('share no commit')
    expect(await headOf(orphan)).toBe(unrelatedHead)
    expect((await git(orphan, ['status', '--porcelain'])).stdout).toBe('')
  })

  it('names the rescue path when the recorded baseline exists neither here nor on the remote', async () => {
    const { local, cloud } = await scenario()
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud)
    const stranger = mkdtempSync(join(tmpdir(), 'atlas-merge-stranger-'))
    await git(stranger, ['init', '--initial-branch=main'])
    writeFileSync(join(stranger, 'x.txt'), 'x\n')
    const foreign = await commitAll(stranger, 'not the baseline')

    const failure = await mergePublishedWorkspace({ cwd: local, ref, base: foreign }).catch(
      (error: unknown) => error,
    )

    if (!(failure instanceof Error)) throw new Error('expected the baseline check to refuse')
    expect(failure.message).toContain('baseline')
    expect(failure.message).toContain(foreign)
    expect(failure.message).toContain(ref)
    expect(failure.message).toContain(CLOUD_WORKSPACE_PATH)
    expect(failure.message).toContain(`git fetch origin ${ref}`)
    expect(failure.message).toContain('merge --squash FETCH_HEAD')
    expect((await git(local, ['status', '--porcelain'])).stdout).toBe(' M app.ts\n?? notes.txt\n')
  })

  it('reports a fetch failure without touching the tree', async () => {
    const { local, lifted, patchedTree } = await scenario()

    const failure = await mergePublishedWorkspace({
      cwd: local,
      ref: 'refs/atlas/descend/brn_spec-missing',
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    }).catch((error: unknown) => error)

    if (!(failure instanceof Error)) throw new Error('expected the fetch to fail')
    expect(failure.message).toContain('fetch')
    expect(readFileSync(join(local, 'app.ts'), 'utf8')).toBe(CARRIED)
  })

  it('merges the same way from a detached checkout', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    await git(local, ['checkout', '--detach', 'HEAD'])
    writeFileSync(join(local, 'local-dirty.txt'), 'dirty while detached\n')
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(readFileSync(join(local, 'cloud-made.txt'), 'utf8')).toBe('from the sandbox\n')
    expect(readFileSync(join(local, 'local-dirty.txt'), 'utf8')).toBe('dirty while detached\n')
    expect(await headOf(local)).toBe(lifted)
    expect(
      (await runGit({ args: ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd: local })).ok,
    ).toBe(false)
  })
})
