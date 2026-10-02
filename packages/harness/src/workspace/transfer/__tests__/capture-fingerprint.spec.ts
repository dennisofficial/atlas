import { afterAll, describe, expect, it } from 'bun:test'
import { chmod, mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { captureWorkspaceArchive } from '../capture'
import { fingerprintWorkspaceTree } from '../capture-fingerprint'
import { createFixture, createScratch, git, type Fixture } from './capture-fixture'
import { rm } from 'node:fs/promises'

const fixtures: Fixture[] = []
const scratches: string[] = []

const fixture = async (): Promise<Fixture> => {
  const made = await createFixture()
  fixtures.push(made)
  return made
}

afterAll(async () => {
  await Promise.all([...fixtures.map((made) => made.cleanup()), ...scratches.map((path) => rm(path, { recursive: true, force: true }))])
})

describe('fingerprintWorkspaceTree', () => {
  it('matches the manifest fingerprint of every captured tree', async () => {
    const made = await fixture()
    const out = await createScratch()
    scratches.push(out)
    const manifest = await captureWorkspaceArchive({ cwd: made.main, destination: join(out, 'a.tar.gz') })
    expect(manifest.trees).toHaveLength(1)
    for (const tree of manifest.trees) {
      expect(await fingerprintWorkspaceTree({ cwd: tree.sourcePath })).toBe(tree.fingerprint)
    }
  })

  it('leaves gitignored untracked files out of the fingerprint but not tracked or force-included ones', async () => {
    const made = await fixture()
    const baseline = await fingerprintWorkspaceTree({ cwd: made.main })

    await writeFile(join(made.main, 'debug.log'), 'changed ignored content\n')
    await writeFile(join(made.main, 'node_modules', 'pkg', 'index.js'), 'changed\n')
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).toBe(baseline)

    await writeFile(join(made.main, 'tracked.log'), 'tracked\n')
    await git({ args: ['add', '-f', 'tracked.log'], cwd: made.main })
    const withTracked = await fingerprintWorkspaceTree({ cwd: made.main })
    expect(withTracked).not.toBe(baseline)
    await writeFile(join(made.main, 'tracked.log'), 'edited\n')
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).not.toBe(withTracked)

    await mkdir(join(made.main, '.atlas'), { recursive: true })
    await writeFile(join(made.main, '.atlas', '.cloudinclude'), 'debug.log\n')
    const forced = await fingerprintWorkspaceTree({ cwd: made.main })
    await writeFile(join(made.main, 'debug.log'), 'now it counts\n')
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).not.toBe(forced)
  })

  it('fingerprints only the tree it is pointed at, whatever other worktrees exist', async () => {
    const made = await fixture()
    const baseline = await fingerprintWorkspaceTree({ cwd: made.main })
    await writeFile(join(made.nested, 'another.txt'), 'x\n')
    await writeFile(join(made.detached, 'another.txt'), 'x\n')
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).toBe(baseline)
  })

  it('ignores stat noise and index layout but notices content and staging changes', async () => {
    const made = await fixture()
    const baseline = await fingerprintWorkspaceTree({ cwd: made.main })

    await utimes(join(made.main, 'README.md'), new Date(0), new Date(1000))
    await git({ args: ['update-index', '--no-split-index'], cwd: made.main })
    await git({ args: ['status', '--short'], cwd: made.main })
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).toBe(baseline)

    await git({ args: ['add', 'untracked.txt'], cwd: made.main })
    const staged = await fingerprintWorkspaceTree({ cwd: made.main })
    expect(staged).not.toBe(baseline)

    await writeFile(join(made.main, 'untracked.txt'), 'changed\n')
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).not.toBe(staged)

    const content = await fingerprintWorkspaceTree({ cwd: made.main })
    await chmod(join(made.main, 'empty-dir'), 0o700)
    expect(await fingerprintWorkspaceTree({ cwd: made.main })).not.toBe(content)
  })
})
