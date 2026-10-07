import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { packReachableObjects } from '../capture-pack'
import { cleanupScratches, createScratch, git } from './capture-fixture'

afterEach(cleanupScratches)

async function seededRepo(): Promise<{ root: string; head: string }> {
  const root = await createScratch()
  await git({ args: ['init', '-b', 'main'], cwd: root })
  await Bun.write(join(root, 'a.txt'), 'main work\n')
  await git({ args: ['add', '.'], cwd: root })
  await git({ args: ['commit', '-m', 'work'], cwd: root })
  return { root, head: await git({ args: ['rev-parse', 'HEAD'], cwd: root }) }
}

const packedBlobs = async ({ outputDir }: { outputDir: string }): Promise<Set<string>> => {
  const index = (await readdir(outputDir)).find((name) => name.endsWith('.idx'))
  if (index === undefined) return new Set()
  const listing = await git({ args: ['verify-pack', '-v', join(outputDir, index)], cwd: outputDir })
  return new Set(
    listing
      .split('\n')
      .filter((line) => line.includes(' blob '))
      .map((line) => line.split(' ')[0] ?? ''),
  )
}

describe('packReachableObjects', () => {
  test('lands an intact pack in the output directory', async () => {
    const { root, head } = await seededRepo()
    const outputDir = join(await createScratch(), 'materialized')
    await Bun.write(join(outputDir, '.keep'), '')

    const names = await packReachableObjects({ cwd: root, commonDir: join(root, '.git'), outputDir, seeds: [head] })

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
    const { root, head } = await seededRepo()
    const outputDir = await createScratch()
    const before = (await readdir(join(root, '.git', 'objects', 'pack'))).sort()

    await packReachableObjects({ cwd: root, commonDir: join(root, '.git'), outputDir, seeds: [head] })

    expect((await readdir(join(root, '.git', 'objects', 'pack'))).sort()).toEqual(before)
  })

  test('does not pull unseeded objects from a sibling linked worktree index', async () => {
    const { root, head } = await seededRepo()
    const sibling = join(await createScratch(), 'sibling')
    await git({ args: ['worktree', 'add', sibling, '-b', 'sibling'], cwd: root })
    await Bun.write(join(sibling, 'sibling-staged.txt'), 'staged only in the sibling\n')
    await git({ args: ['add', 'sibling-staged.txt'], cwd: sibling })
    const siblingBlob = await git({ args: ['rev-parse', ':sibling-staged.txt'], cwd: sibling })

    const outputDir = await createScratch()
    await packReachableObjects({ cwd: root, commonDir: join(root, '.git'), outputDir, seeds: [head] })

    expect(await packedBlobs({ outputDir })).not.toContain(siblingBlob)
  })

  test('includes explicitly seeded index objects from covered worktrees', async () => {
    const { root, head } = await seededRepo()
    const sibling = join(await createScratch(), 'sibling')
    await git({ args: ['worktree', 'add', sibling, '-b', 'sibling'], cwd: root })
    await Bun.write(join(sibling, 'sibling-staged.txt'), 'staged only in the sibling\n')
    await git({ args: ['add', 'sibling-staged.txt'], cwd: sibling })
    const siblingBlob = await git({ args: ['rev-parse', ':sibling-staged.txt'], cwd: sibling })
    await mkdir(join(root, 'staged-root.txt').replace('staged-root.txt', ''), { recursive: true })
    await Bun.write(join(root, 'staged-root.txt'), 'staged in the main tree\n')
    await git({ args: ['add', 'staged-root.txt'], cwd: root })
    const mainBlob = await git({ args: ['rev-parse', ':staged-root.txt'], cwd: root })

    const outputDir = await createScratch()
    await packReachableObjects({
      cwd: root,
      commonDir: join(root, '.git'),
      outputDir,
      seeds: [head, siblingBlob, mainBlob],
    })

    const blobs = await packedBlobs({ outputDir })
    expect(blobs).toContain(siblingBlob)
    expect(blobs).toContain(mainBlob)
  })
})
