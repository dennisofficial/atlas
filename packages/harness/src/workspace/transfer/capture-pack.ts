import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureGit } from './capture-git'

const PACK_BASE = 'pack'

const REACHABILITY_FLAGS = ['--all', '--reflog', '--indexed-objects'] as const

export async function packReachableObjects({
  cwd,
  outputDir,
}: {
  cwd: string
  outputDir: string
}): Promise<string[]> {
  const scratch = await mkdtemp(join(tmpdir(), 'atlas-pack-revs-'))
  try {
    const stdinPath = join(scratch, 'revs')
    await writeFile(stdinPath, '')
    const run = await captureGit({
      args: ['pack-objects', '--quiet', '--revs', ...REACHABILITY_FLAGS, join(outputDir, PACK_BASE)],
      cwd,
      stdinPath,
    })
    if (!run.ok) throw new Error(`Cannot pack the reachable objects of ${cwd}: ${run.stderr.trim()}`)
    const written = await readdir(outputDir)
    return written.filter((name) => name.startsWith(`${PACK_BASE}-`))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
