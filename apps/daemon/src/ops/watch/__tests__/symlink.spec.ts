import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { DEBOUNCE_MS, type Rig, quiet, rig, scratchRoot, waitUntil } from './watch-rig'

type Fixture = { base: string; root: string; target: string; link: string }

const fixtureOf = async (): Promise<Fixture> => {
  const base = await scratchRoot()
  const root = join(base, 'repo')
  await mkdir(root, { recursive: true })
  const target = join(root, 'CLAUDE.md')
  await writeFile(target, 'first')
  const link = join(root, 'AGENTS.md')
  await symlink('CLAUDE.md', link)
  return { base, root, target, link }
}

const watchInstructions = async (watch: Rig, root: string): Promise<void> => {
  await watch.call({
    op: 'watch.start',
    watchId: 'w1',
    roots: [root],
    basenames: ['AGENTS.md'],
    debounceMs: DEBOUNCE_MS,
  })
}

const reportedPaths = (watch: Rig): string[] =>
  watch.changes().flatMap((change) => [...change.paths])

describe('a watch that names a symlink', () => {
  it('reports an edit of the symlink target', async () => {
    const { base, root, target } = await fixtureOf()
    const watch = rig()
    try {
      await watchInstructions(watch, root)
      await writeFile(target, 'second')
      await waitUntil(() => watch.changes().length > 0)
      expect(reportedPaths(watch)).toContain(target)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('reports a save that renames a temporary file onto the symlink target', async () => {
    const { base, root, target } = await fixtureOf()
    const watch = rig()
    try {
      await watchInstructions(watch, root)
      const temporary = join(root, 'CLAUDE.md.tmp')
      await writeFile(temporary, 'second')
      await rename(temporary, target)
      await waitUntil(() => reportedPaths(watch).includes(target))
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })

  it('stays quiet for another file in the same directory', async () => {
    const { base, root } = await fixtureOf()
    const watch = rig()
    try {
      await watchInstructions(watch, root)
      await writeFile(join(root, 'OTHER.md'), 'ignored')
      await quiet(200)
      expect(watch.changes()).toHaveLength(0)
    } finally {
      await watch.stop()
      await rm(base, { recursive: true, force: true })
    }
  })
})
