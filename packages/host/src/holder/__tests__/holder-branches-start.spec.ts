import { describe, expect, it } from 'bun:test'

import type { BranchSet } from '@dltech/atlas-protocol'
import { defineOp, type DaemonGroupFactory } from '@dltech/atlas-protocol/engine'
import { createInMemoryDaemon } from '@dltech/atlas-protocol/testing'

import { flushUntil, makeRig, SANDBOX, SECRET, seedSession, type HolderRig } from './holder-rig'

const SET: BranchSet = {
  repoPath: '/w',
  head: 'aaa111',
  branches: [{ name: 'main', sha: 'aaa111', pushRemote: null }],
  worktrees: [{ path: '/w', branch: 'main', sha: 'aaa111', detached: false }],
  remotes: [{ name: 'origin', url: 'git@github.com:acme/app.git' }],
  checkouts: ['main'],
}

const gitGroup: DaemonGroupFactory = () => ({
  name: 'git',
  ops: [
    defineOp({
      op: 'git.read',
      run: async ({ op }) => ({ ...SET, repoPath: op.repoPath }),
    }),
  ],
})

const readingDaemon = () =>
  createInMemoryDaemon({
    version: 'test',
    sandboxName: SANDBOX,
    secret: SECRET,
    groups: () => [gitGroup],
  })

const typesOf = async (rig: HolderRig): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

describe('the boot branch observation', () => {
  it('holds the first turn until it is recorded', async () => {
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const rig = await makeRig({
      daemon: await readingDaemon(),
      script: [{ text: 'made it' }],
      watchedRepos: () => gate.then(() => ['/w']),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    await rig.flush()
    expect(rig.runtimes).toHaveLength(1)
    expect(await typesOf(rig)).not.toContain('assistant-said')

    open()
    const said = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
    })
    expect(said).toBe(true)
    const types = await typesOf(rig)
    expect(types).toContain('branches-observed')
    expect(types.indexOf('branches-observed')).toBeLessThan(types.indexOf('assistant-said'))
    rig.holder.discard()
  })

  it('starts the turn once a hung read passes the refresh cap', async () => {
    const rig = await makeRig({
      script: [{ text: 'hung read' }],
      watchedRepos: () => new Promise<readonly string[]>(() => {}),
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.post('go')
    await rig.wake()
    await rig.flush()
    expect(rig.runtimes).toHaveLength(1)
    expect(await typesOf(rig)).not.toContain('assistant-said')

    const said = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      clock: rig.clock,
      attempts: 10,
      advanceMs: 10_000,
    })
    expect(said).toBe(true)
    rig.holder.discard()
  })
})
