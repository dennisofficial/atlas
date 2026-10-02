import { afterAll, describe, expect, it } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { digestGitAdmin } from '../capture-admin'
import { snapshotWorkspaceTree } from '../capture-fingerprint'
import { createFixture, git, type Fixture } from './capture-fixture'

const fixtures: Fixture[] = []

const fixture = async (): Promise<Fixture> => {
  const made = await createFixture()
  fixtures.push(made)
  return made
}

afterAll(async () => {
  await Promise.all(fixtures.map((made) => made.cleanup()))
})

const digestOf = (made: Fixture): Promise<string> =>
  digestGitAdmin({ cwds: [made.main, made.nested, made.detached] })

describe('digestGitAdmin', () => {
  it('is stable when nothing changes and when only stat data is refreshed', async () => {
    const made = await fixture()
    const before = await digestOf(made)
    await git({ args: ['status', '--short'], cwd: made.main })
    expect(await digestOf(made)).toBe(before)
  })

  it('notices a side ref, a config edit and in-progress state', async () => {
    const made = await fixture()
    const base = await digestOf(made)

    await git({ args: ['branch', 'side'], cwd: made.main })
    const withRef = await digestOf(made)
    expect(withRef).not.toBe(base)

    await git({ args: ['config', 'atlas.test', 'on'], cwd: made.main })
    const withConfig = await digestOf(made)
    expect(withConfig).not.toBe(withRef)

    const head = await git({ args: ['rev-parse', 'HEAD'], cwd: made.nested })
    const gitDir = await git({ args: ['rev-parse', '--absolute-git-dir'], cwd: made.nested })
    await writeFile(join(gitDir, 'MERGE_HEAD'), `${head}\n`)
    expect(await digestOf(made)).not.toBe(withConfig)
  })

  it('ignores newly added objects', async () => {
    const made = await fixture()
    const before = await digestOf(made)
    await writeFile(join(made.scratch, 'blob'), 'x')
    await git({ args: ['hash-object', '-w', join(made.scratch, 'blob')], cwd: made.main })
    expect(await digestOf(made)).toBe(before)
  })
})

describe('snapshotWorkspaceTree', () => {
  it('reports the head and branch current at snapshot time', async () => {
    const made = await fixture()
    const first = await snapshotWorkspaceTree({ cwd: made.nested })
    expect(first.branch).toBe('feat')
    expect(first.head).toBe(await git({ args: ['rev-parse', 'HEAD'], cwd: made.nested }))

    await git({ args: ['checkout', '-b', 'moved'], cwd: made.nested })
    await git({ args: ['commit', '--allow-empty', '-m', 'moved'], cwd: made.nested })
    const second = await snapshotWorkspaceTree({ cwd: made.nested })
    expect(second.branch).toBe('moved')
    expect(second.head).toBe(await git({ args: ['rev-parse', 'HEAD'], cwd: made.nested }))
    expect(second.fingerprint).not.toBe(first.fingerprint)

    const detached = await snapshotWorkspaceTree({ cwd: made.detached })
    expect(detached.branch).toBeNull()
    expect(detached.head).not.toBeNull()
  })
})
