import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { captureGit } from './capture-git'

const ALTERNATES_FILE = join('objects', 'info', 'alternates')
const PACK_BASE = 'pack'

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

async function alternateDirectories({ commonDir }: { commonDir: string }): Promise<string[]> {
  const file = join(commonDir, ALTERNATES_FILE)
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return []
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => (isAbsolute(line) ? line : resolve(dirname(file), line)))
}

export async function materializeBorrowedObjects({
  commonDir,
  treeRoots,
  outputDir,
}: {
  commonDir: string
  treeRoots: readonly string[]
  outputDir: string
}): Promise<string[]> {
  const alternates = await alternateDirectories({ commonDir })
  if (alternates.length === 0) return []
  for (const directory of alternates) {
    if (!(await exists(directory))) {
      throw new Error(`Cannot capture ${commonDir}: alternate object directory ${directory} does not exist, so borrowed objects cannot be materialized`)
    }
  }
  const [firstRoot, ...otherRoots] = treeRoots
  if (firstRoot === undefined) return []
  const headsPath = join(dirname(outputDir), 'pack-revs')
  await writeFile(headsPath, 'HEAD\n')
  const packs: Array<{ cwd: string; args: string[] }> = [
    { cwd: firstRoot, args: ['--revs', '--all', '--reflog', '--indexed-objects'] },
    ...otherRoots.map((cwd) => ({ cwd, args: ['--revs', '--indexed-objects'] })),
  ]
  for (const [index, pack] of packs.entries()) {
    const run = await captureGit({
      args: ['pack-objects', '--quiet', ...pack.args, join(outputDir, `${PACK_BASE}-${index}`)],
      cwd: pack.cwd,
      stdinPath: headsPath,
    })
    if (!run.ok) throw new Error(`Cannot materialize borrowed objects of ${commonDir}: ${run.stderr.trim()}`)
  }
  const written = await readdir(outputDir)
  return written.filter((name) => name.startsWith(`${PACK_BASE}-`))
}
