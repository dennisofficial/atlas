import { afterAll, describe, expect, it } from 'bun:test'
import { chmod, utimes, writeFile } from 'node:fs/promises'
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
    for (const tree of manifest.trees) {
      expect(await fingerprintWorkspaceTree({ cwd: tree.sourcePath })).toBe(tree.fingerprint)
    }
    const main = manifest.trees.find((tree) => tree.isMain)
    const partial = await fingerprintWorkspaceTree({ cwd: made.main, excludedRoots: [made.nested] })
    expect(partial).toBe(main?.fingerprint ?? '')
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
