import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ECompactionAnchor, EForkMode, EWorktreeExit } from '@dltech/atlas-core'

import { threadMetaFile } from '../../store/sessions/paths'
import { FAMILY_OWNERSHIP_FILE, ensureFamilyOwnership, presentFamilyCheckouts, readFamilyOwnership, writeFamilyOwnership } from '../family-ownership'
import { claimCheckoutMarker } from '../family-ownership-git'
import {
  addLinked,
  appendTo,
  cleanupFixtures,
  entered,
  exited,
  git,
  makeRepo,
  markerOf,
  nudge,
  openFixture,
  removeLinked,
  sessionDirOf,
  spawnChild,
  startRoot,
} from './family-ownership-fixture'

afterEach(cleanupFixtures)

const pathsOf = (ownership: Awaited<ReturnType<typeof readFamilyOwnership>>): string[] =>
  (ownership?.checkouts ?? []).map((checkout) => checkout.path).sort()

describe('seeding a session that predates the inventory', () => {
  it('rebuilds it from kept, removed and launch workspaces including finished descendants', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const kept = await addLinked({ repo: fx.repo, root: fx.root, name: 'kept' })
    const gone = await addLinked({ repo: fx.repo, root: fx.root, name: 'gone' })
    const launched = await addLinked({ repo: fx.repo, root: fx.root, name: 'launched' })
    await addLinked({ repo: fx.repo, root: fx.root, name: 'stranger' })
    const child = await spawnChild({ fx, parent: rootId, workspace: launched })

    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: kept }), exited({ path: kept, action: EWorktreeExit.Keep, returnTo: fx.repo })] })
    await appendTo({ fx, threadId: child, drafts: [entered({ path: gone }), exited({ path: gone, action: EWorktreeExit.Remove })] })
    await removeLinked({ repo: fx.repo, path: gone })
    await rm(join(sessionDir, FAMILY_OWNERSHIP_FILE))

    const seeded = await ensureFamilyOwnership({ sessionDir, registry: fx.registry })
    expect(pathsOf(seeded)).toEqual([kept, launched].sort())
    expect(await readFamilyOwnership({ sessionDir })).toEqual(seeded)
    expect(await presentFamilyCheckouts({ ownership: seeded! })).toEqual(seeded!.checkouts)
  })

  it('does not undo a removal with the same thread stale launch workspace', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'launchgone' })
    const child = await spawnChild({ fx, parent: rootId, workspace: wt })
    await appendTo({ fx, threadId: child, drafts: [exited({ path: wt, action: EWorktreeExit.Remove })] })
    await removeLinked({ repo: fx.repo, path: wt })
    await rm(join(sessionDir, FAMILY_OWNERSHIP_FILE), { force: true })
    expect((await ensureFamilyOwnership({ sessionDir, registry: fx.registry }))?.checkouts).toEqual([])
  })

  it('keeps a checkout the launch workspace sits inside after an exited Keep', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'insidekeep' })
    const child = await spawnChild({ fx, parent: rootId, workspace: wt })
    await appendTo({ fx, threadId: child, drafts: [exited({ path: wt, action: EWorktreeExit.Keep, returnTo: fx.repo }), nudge()] })
    expect(pathsOf(await readFamilyOwnership({ sessionDir }))).toEqual([wt])
  })
})

describe('inventory lifetime', () => {
  it('survives a summarise that deletes the child', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const child = await spawnChild({ fx, parent: rootId })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'childwork' })
    await appendTo({ fx, threadId: rootId, drafts: [nudge(), nudge()] })
    await appendTo({ fx, threadId: child, drafts: [entered({ path: wt }), exited({ path: wt, action: EWorktreeExit.Keep, returnTo: fx.repo })] })
    await rm(join(sessionDir, FAMILY_OWNERSHIP_FILE))

    await fx.threads.summarise({ threadId: rootId, anchor: ECompactionAnchor.Prefix, fromSeq: 1, throughSeq: 2, summary: 's', cutAgents: [child] })
    expect(await fx.threads.find({ threadId: child })).toBeUndefined()
    expect(pathsOf(await readFamilyOwnership({ sessionDir }))).toEqual([wt])
  })

  it('survives a rewind that cuts the child', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const child = await spawnChild({ fx, parent: rootId })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'rewound' })
    await appendTo({ fx, threadId: rootId, drafts: [nudge(), nudge()] })
    await appendTo({ fx, threadId: child, drafts: [entered({ path: wt })] })
    await rm(join(sessionDir, FAMILY_OWNERSHIP_FILE))

    await fx.threads.rewind({ threadId: rootId, toSeq: 1, cutAgents: [child] })
    expect(await fx.threads.find({ threadId: child })).toBeUndefined()
    expect(pathsOf(await readFamilyOwnership({ sessionDir }))).toEqual([wt])
  })

  it('is not copied into a fork, which begins an independent inventory', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'parentonly' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt }), nudge()] })

    const fork = await fx.threads.fork({ from: rootId, seq: 2, mode: EForkMode.Copy })
    await appendTo({ fx, threadId: fork.id, drafts: [nudge()] })

    const forkOwnership = await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId: fork.id }) })
    expect(forkOwnership?.rootId).toBe(fork.id)
    expect(forkOwnership?.checkouts).toEqual([])
    expect(pathsOf(await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))).toEqual([wt])
  })
})

describe('launch and directory adoption from inside a linked checkout', () => {
  it('owns the registered toplevel when a thread launches in a subdirectory', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    await appendTo({ fx, threadId: rootId, drafts: [nudge()] })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'nestedlaunch' })
    const nested = join(wt, 'pkg', 'deep')
    await mkdir(nested, { recursive: true })
    const child = await spawnChild({ fx, parent: rootId, workspace: nested })
    await appendTo({ fx, threadId: child, drafts: [nudge()] })
    const ownership = (await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))!
    expect(pathsOf(ownership)).toEqual([wt])
    expect(await presentFamilyCheckouts({ ownership })).toEqual(ownership.checkouts)
  })

  it('seeds the toplevel of a legacy session that launched in a subdirectory', async () => {
    const fx = await openFixture()
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'legacynested' })
    const nested = join(wt, 'src')
    await mkdir(nested, { recursive: true })
    const rootId = (await fx.threads.create({ title: 'r', workspace: nested, repo: fx.repo })).id
    const sessionDir = sessionDirOf({ fx, rootId })
    expect(pathsOf(await ensureFamilyOwnership({ sessionDir, registry: fx.registry }))).toEqual([wt])
  })

  it('owns the toplevel when a thread changes directory into a nested folder', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'cdnested' })
    const nested = join(wt, 'lib')
    await mkdir(nested, { recursive: true })
    await appendTo({ fx, threadId: rootId, drafts: [{ type: 'directory-changed', path: nested, repo: fx.repo }] })
    expect(pathsOf(await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))).toEqual([wt])
  })

  it('never reclaims a mismatched checkout through a directory change', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'cdmismatch' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    const before = (await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))!
    await removeLinked({ repo: fx.repo, path: wt })
    await git(['worktree', 'add', wt, 'cdmismatch'], fx.repo)
    await appendTo({ fx, threadId: rootId, drafts: [{ type: 'directory-changed', path: wt, repo: fx.repo }] })
    const after = (await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))!
    expect(after.checkouts).toEqual(before.checkouts)
    expect(await presentFamilyCheckouts({ ownership: after })).toEqual([])
  })
})

describe('strict failures and marker races', () => {
  it('lets two claimers of one checkout agree on a single generation', async () => {
    const fx = await openFixture()
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'race' })
    const ids = await Promise.all(Array.from({ length: 8 }, () => claimCheckoutMarker({ checkout: wt })))
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toBe(await markerOf({ checkout: wt }))
  })

  it('throws instead of guessing when a thread meta cannot be read', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    await appendTo({ fx, threadId: rootId, drafts: [nudge()] })
    await rm(join(sessionDir, FAMILY_OWNERSHIP_FILE))
    const metaFile = threadMetaFile({ sessionDir, threadId: rootId })
    await rm(metaFile)
    await mkdir(metaFile)
    await expect(ensureFamilyOwnership({ sessionDir, registry: fx.registry })).rejects.toThrow()
  })
})

describe('a workspace that belongs to the other side of a transfer', () => {
  it('appends ordinary bookkeeping without inspecting the absent primary or changing the inventory', async () => {
    const fx = await openFixture()
    const local = await addLinked({ repo: fx.repo, root: fx.root, name: 'hostside' })
    const rootId = (await fx.threads.create({ title: 'r', workspace: local, repo: fx.repo })).id
    const sessionDir = sessionDirOf({ fx, rootId })
    const foreign = { version: 1 as const, rootId, primaryRepository: join(fx.root, 'absent-cloud', 'repo'), checkouts: [{ id: 'cloud-id', path: join(fx.root, 'absent-cloud', 'wt'), claimedBy: rootId }] }
    await writeFamilyOwnership({ sessionDir, ownership: foreign })

    await appendTo({ fx, threadId: rootId, drafts: [{ type: 'user-said', text: 'hi' }, nudge()] })
    await appendTo({ fx, threadId: rootId, drafts: [{ type: 'directory-changed', path: local, repo: fx.repo }] })
    expect(await readFamilyOwnership({ sessionDir })).toEqual(foreign)
  })

  it('stays fail-closed for an explicit worktree entry while the primary is unavailable', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const foreign = { version: 1 as const, rootId, primaryRepository: join(fx.root, 'absent-cloud', 'repo'), checkouts: [] }
    await writeFamilyOwnership({ sessionDir, ownership: foreign })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'explicit' })
    await expect(appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })).rejects.toThrow()
    expect(await readFamilyOwnership({ sessionDir })).toEqual(foreign)
  })

  it('does not claim a linked checkout of a different repository', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    await appendTo({ fx, threadId: rootId, drafts: [nudge()] })
    const otherRoot = join(fx.root, 'other')
    await mkdir(otherRoot, { recursive: true })
    const other = await makeRepo({ root: otherRoot })
    const stranger = await addLinked({ repo: other, root: otherRoot, name: 'foreign' })
    const child = await spawnChild({ fx, parent: rootId, workspace: stranger })
    await appendTo({ fx, threadId: child, drafts: [nudge()] })
    expect((await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))?.checkouts).toEqual([])
  })
})

describe('root metadata and sessions that started outside Git', () => {
  it('throws on a malformed or unreadable root meta instead of seeding an empty inventory', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const sessionDir = sessionDirOf({ fx, rootId })
    const meta = join(sessionDir, 'meta.json')
    await rm(meta)
    expect(await ensureFamilyOwnership({ sessionDir, registry: fx.registry })).toBeNull()
    await writeFile(meta, '{not json')
    await expect(ensureFamilyOwnership({ sessionDir, registry: fx.registry })).rejects.toThrow()
    await rm(meta)
    await mkdir(meta)
    await expect(ensureFamilyOwnership({ sessionDir, registry: fx.registry })).rejects.toThrow()
    expect(await readFamilyOwnership({ sessionDir })).toBeNull()
  })

  it('seeds from the registered primary when a plain-folder session later became a repository with a worktree', async () => {
    const fx = await openFixture()
    const plain = join(fx.root, 'plainstart')
    await mkdir(plain, { recursive: true })
    const rootId = (await fx.threads.create({ title: 'r', workspace: plain, repo: null })).id
    const sessionDir = sessionDirOf({ fx, rootId })
    expect(await ensureFamilyOwnership({ sessionDir, registry: fx.registry })).toBeNull()
    expect(await readFamilyOwnership({ sessionDir })).toBeNull()

    await git(['init', '-b', 'main'], plain)
    await git(['config', 'user.email', 'test@example.com'], plain)
    await git(['config', 'user.name', 'Test'], plain)
    await Bun.write(join(plain, 'a.txt'), 'a')
    await git(['add', '.'], plain)
    await git(['commit', '-m', 'init'], plain)
    const wt = await addLinked({ repo: plain, root: fx.root, name: 'plainwt' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    const ownership = (await readFamilyOwnership({ sessionDir }))!
    expect(ownership.primaryRepository).toBe(plain)
    expect(pathsOf(ownership)).toEqual([wt])
    expect(await presentFamilyCheckouts({ ownership })).toEqual(ownership.checkouts)
  })

  it('seeds a legacy plain-start session whose workspace is now a worktree', async () => {
    const fx = await openFixture()
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'legacyplain' })
    const rootId = (await fx.threads.create({ title: 'r', workspace: wt, repo: null })).id
    const sessionDir = sessionDirOf({ fx, rootId })
    const seeded = await ensureFamilyOwnership({ sessionDir, registry: fx.registry })
    expect(seeded?.primaryRepository).toBe(fx.repo)
    expect(pathsOf(seeded)).toEqual([wt])
  })
})
