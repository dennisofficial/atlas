import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mergePublishedWorkspace } from '../merge-published'
import { commitAll, git, publishFrom, scenario } from './merge-fixture'

const pushMainForward = async (remote: string): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-merge-ship-'))
  const elsewhere = join(root, 'elsewhere')
  await git(root, ['clone', '--', remote, elsewhere])
  writeFileSync(join(elsewhere, 'shipped.txt'), 'shipped while lifted\n')
  const tip = await commitAll(elsewhere, 'shipped from the cloud')
  await git(elsewhere, ['push', 'origin', 'HEAD:main'])
  return tip
}

describe('mergePublishedWorkspace reconciling a moved branch tip', () => {
  it('flags the host branch when origin moved ahead while the session was away', async () => {
    const { remote, local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)
    const originTip = await pushMainForward(remote)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(merged.superseded).toEqual({ branch: 'main', localTip: lifted, originTip })
  })

  it('says nothing when the host branch holds commits origin does not', async () => {
    const { remote, local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(local, 'host-only.txt'), 'the operator kept working here\n')
    await commitAll(local, 'host work the origin never saw')
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)
    await pushMainForward(remote)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.conflicts).toEqual([])
    expect(merged.superseded).toBeUndefined()
  })

  it('says nothing when the branch tip never moved', async () => {
    const { local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: 'main',
    })

    expect(merged.superseded).toBeUndefined()
  })

  it('skips the reconciliation entirely when no branch rode down with the publish', async () => {
    const { remote, local, cloud, lifted, patchedTree } = await scenario()
    writeFileSync(join(cloud, 'cloud-made.txt'), 'from the sandbox\n')
    const ref = await publishFrom(cloud, patchedTree)
    await pushMainForward(remote)

    const merged = await mergePublishedWorkspace({
      cwd: local,
      ref,
      base: lifted,
      baseTree: patchedTree,
      branch: null,
    })

    expect(merged.conflicts).toEqual([])
    expect(merged.superseded).toBeUndefined()
  })
})
