import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { packReachableObjects } from '../capture-pack'
import { cleanupScratches, createScratch, git } from './capture-fixture'

afterEach(cleanupScratches)

async function seededRepo(): Promise<{ root: string }> {
  const root = await createScratch()
  await git({ args: ['init', '-b', 'main'], cwd: root })
  await Bun.write(join(root, 'a.txt'), 'main work\n')
  await git({ args: ['add', '.'], cwd: root })
  await git({ args: ['commit', '-m', 'work'], cwd: root })
  return { root }
}

describe('packReachableObjects', () => {
  test('lands an intact pack in the output directory', async () => {
    const { root } = await seededRepo()
    const outputDir = join(await createScratch(), 'materialized')
    await Bun.write(join(outputDir, '.keep'), '')

    const names = await packReachableObjects({ cwd: root, commonDir: join(root, '.git'), outputDir })

    expect(names.filter((name) => name.endsWith('.pack'))).toHaveLength(1)
    const index = names.find((name) => name.endsWith('.idx'))
    expect(index).toBeDefined()
    for (const name of names) {
      expect((await stat(join(outputDir, name))).isFile()).toBe(true)
    }
    await git({ args: ['verify-pack', join(outputDir, index!)], cwd: root })
    const pack = await stat(join(outputDir, names.find((name) => name.endsWith('.pack'))!))
    expect(pack.size).toBeGreaterThan(0)
  })

  test('leaves no scratch behind in the repository object store', async () => {
    const { root } = await seededRepo()
    const outputDir = await createScratch()
    const before = (await readdir(join(root, '.git', 'objects', 'pack'))).sort()

    await packReachableObjects({ cwd: root, commonDir: join(root, '.git'), outputDir })

    expect((await readdir(join(root, '.git', 'objects', 'pack'))).sort()).toEqual(before)
  })
})
