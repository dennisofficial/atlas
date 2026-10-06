import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { EWorktreeExit } from '@dltech/atlas-core'

import { readMetaSync, threadMetaSchema } from '../../store/sessions/meta'
import { threadMetaFile } from '../../store/sessions/paths'
import { ensureFamilyOwnership, presentFamilyCheckouts, readFamilyOwnership, writeFamilyOwnership } from '../family-ownership'
import {
  addLinked,
  appendTo,
  cleanupFixtures,
  entered,
  exited,
  git,
  markerOf,
  nudge,
  openFixture,
  removeLinked,
  sessionDirOf,
  spawnChild,
  startRoot,
  tempRoot,
} from './family-ownership-fixture'

afterEach(cleanupFixtures)

describe('the ownership inventory file', () => {
  it('reads as null before anything is written', async () => {
    const root = await tempRoot()
    expect(await readFamilyOwnership({ sessionDir: root })).toBeNull()
  })

  it('round-trips and replaces atomically', async () => {
    const root = await tempRoot()
    const ownership = { version: 1 as const, rootId: 'r', primaryRepository: '/p', checkouts: [{ id: 'a', path: '/p/w', claimedBy: 'r' }] }
    await writeFamilyOwnership({ sessionDir: root, ownership })
    expect(await readFamilyOwnership({ sessionDir: root })).toEqual(ownership)
    await writeFamilyOwnership({ sessionDir: root, ownership: { ...ownership, checkouts: [] } })
    expect((await readFamilyOwnership({ sessionDir: root }))?.checkouts).toEqual([])
  })

  it('throws on a document that is not valid rather than treating it as absent', async () => {
    const root = await tempRoot()
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'workspace-ownership.json'), JSON.stringify({ version: 2 }))
    await expect(readFamilyOwnership({ sessionDir: root })).rejects.toThrow()
    await writeFile(join(root, 'workspace-ownership.json'), '{not json')
    await expect(readFamilyOwnership({ sessionDir: root })).rejects.toThrow()
  })
})

describe('tracking a family through the event log', () => {
  it('records a worktree a thread enters, marks its git admin, and keeps it after Keep and finish', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'one' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    await appendTo({ fx, threadId: rootId, drafts: [exited({ path: wt, action: EWorktreeExit.Keep, returnTo: fx.repo }), nudge()] })

    const sessionDir = sessionDirOf({ fx, rootId })
    const ownership = await readFamilyOwnership({ sessionDir })
    expect(ownership?.rootId).toBe(rootId)
    expect(ownership?.primaryRepository).toBe(fx.repo)
    expect(ownership?.checkouts.map((checkout) => checkout.path)).toEqual([wt])
    expect(ownership?.checkouts[0]?.claimedBy).toBe(rootId)
    expect(ownership?.checkouts[0]?.id).toBe(await markerOf({ checkout: wt }))
    expect(await presentFamilyCheckouts({ ownership: ownership! })).toEqual(ownership!.checkouts)
  })

  it('claims one generation when two threads enter the same path', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const child = await spawnChild({ fx, parent: rootId })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'shared' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    await appendTo({ fx, threadId: child, drafts: [entered({ path: wt })] })
    const ownership = await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) })
    expect(ownership?.checkouts).toHaveLength(1)
  })

  it('omits registered checkouts that nothing in the family ever touched', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    await addLinked({ repo: fx.repo, root: fx.root, name: 'stranger' })
    await appendTo({ fx, threadId: rootId, drafts: [nudge()] })
    const ownership = await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) })
    expect(ownership?.checkouts).toEqual([])
  })

  it('excludes a removed checkout and a manual same-path recreation until it is entered again', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'cycle' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    const sessionDir = sessionDirOf({ fx, rootId })
    const first = (await readFamilyOwnership({ sessionDir }))!

    await removeLinked({ repo: fx.repo, path: wt })
    expect(await presentFamilyCheckouts({ ownership: first })).toEqual([])

    await git(['worktree', 'add', wt, 'cycle'], fx.repo)
    expect(await presentFamilyCheckouts({ ownership: first })).toEqual([])

    await appendTo({ fx, threadId: rootId, drafts: [nudge()] })
    expect(await presentFamilyCheckouts({ ownership: (await readFamilyOwnership({ sessionDir }))! })).toEqual([])

    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    const second = (await readFamilyOwnership({ sessionDir }))!
    expect(second.checkouts).toHaveLength(1)
    expect(second.checkouts[0]?.id).not.toBe(first.checkouts[0]?.id)
    expect(await presentFamilyCheckouts({ ownership: second })).toEqual(second.checkouts)
  })

  it('does not reclaim a mismatched checkout just because a new child starts inside it', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'again' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    await removeLinked({ repo: fx.repo, path: wt })
    await git(['worktree', 'add', wt, 'again'], fx.repo)

    const child = await spawnChild({ fx, parent: rootId, workspace: wt })
    await appendTo({ fx, threadId: child, drafts: [nudge()] })
    const ownership = (await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))!
    expect(await presentFamilyCheckouts({ ownership })).toEqual([])
  })

  it('claims the workspace of a new child that starts inside an unowned linked checkout', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    await appendTo({ fx, threadId: rootId, drafts: [nudge()] })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'launch' })
    const child = await spawnChild({ fx, parent: rootId, workspace: wt })
    await appendTo({ fx, threadId: child, drafts: [nudge()] })
    const ownership = (await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))!
    expect(ownership.checkouts.map((checkout) => [checkout.path, checkout.claimedBy])).toEqual([[wt, child]])
  })

  it('serializes concurrent teammate entries without losing either', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const a = await spawnChild({ fx, parent: rootId })
    const b = await spawnChild({ fx, parent: rootId })
    const wtA = await addLinked({ repo: fx.repo, root: fx.root, name: 'ta' })
    const wtB = await addLinked({ repo: fx.repo, root: fx.root, name: 'tb' })
    await Promise.all([appendTo({ fx, threadId: a, drafts: [entered({ path: wtA })] }), appendTo({ fx, threadId: b, drafts: [entered({ path: wtB })] })])
    const ownership = (await readFamilyOwnership({ sessionDir: sessionDirOf({ fx, rootId }) }))!
    expect(ownership.checkouts.map((checkout) => checkout.path).sort()).toEqual([wtA, wtB].sort())
  })
})

describe('sessions that are not git workspaces', () => {
  it('yields no inventory and creates nothing for a plain or missing workspace', async () => {
    const fx = await openFixture()
    const plain = await fx.threads.create({ title: 'plain', workspace: fx.root, repo: null })
    await appendTo({ fx, threadId: plain.id, drafts: [nudge()] })
    const sessionDir = sessionDirOf({ fx, rootId: plain.id })
    expect(await readFamilyOwnership({ sessionDir })).toBeNull()
    expect(await ensureFamilyOwnership({ sessionDir, registry: fx.registry })).toBeNull()
    expect(await ensureFamilyOwnership({ sessionDir: join(fx.root, 'nowhere'), registry: fx.registry })).toBeNull()
  })

  it('refuses to inspect a primary repository that git cannot read', async () => {
    const root = await tempRoot()
    const ownership = { version: 1 as const, rootId: 'r', primaryRepository: join(root, 'gone'), checkouts: [{ id: 'a', path: join(root, 'w'), claimedBy: 'r' }] }
    await expect(presentFamilyCheckouts({ ownership })).rejects.toThrow()
  })
})

describe('thread meta stays untouched by tracking', () => {
  it('leaves the thread meta workspace as the launch workspace', async () => {
    const fx = await openFixture()
    const rootId = await startRoot({ fx })
    const wt = await addLinked({ repo: fx.repo, root: fx.root, name: 'meta' })
    await appendTo({ fx, threadId: rootId, drafts: [entered({ path: wt })] })
    const meta = readMetaSync({ file: threadMetaFile({ sessionDir: sessionDirOf({ fx, rootId }), threadId: rootId }), schema: threadMetaSchema })
    expect(meta?.workspace).toBe(fx.repo)
  })
})
