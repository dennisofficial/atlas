import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureGit } from './capture-git'

const PACK_BASE = 'pack'

const REACHABILITY_FLAGS = ['--indexed-objects'] as const

export async function packReachableObjects({
  cwd,
  commonDir,
  outputDir,
  seeds,
}: {
  cwd: string
  commonDir: string
  outputDir: string
  seeds: readonly string[]
}): Promise<string[]> {
  const stdinScratch = await mkdtemp(join(tmpdir(), 'atlas-pack-revs-'))
  // pack-objects renames its temp file from .git/objects/pack onto the output prefix, so the
  // output must share that filesystem — a stage under another mount fails the rename with EXDEV.
  const packRoot = join(commonDir, 'objects', 'pack')
  await mkdir(packRoot, { recursive: true })
  const packScratch = await mkdtemp(join(packRoot, 'atlas-capture-'))
  try {
    const stdinPath = join(stdinScratch, 'revs')
    await writeFile(stdinPath, seeds.length === 0 ? '' : `${seeds.join('\n')}\n`)
    const run = await captureGit({
      args: ['pack-objects', '--quiet', '--revs', ...REACHABILITY_FLAGS, join(packScratch, PACK_BASE)],
      cwd,
      stdinPath,
    })
    if (!run.ok) throw new Error(`Cannot pack the reachable objects of ${cwd}: ${run.stderr.trim()}`)
    const written = (await readdir(packScratch)).filter((name) => name.startsWith(`${PACK_BASE}-`))
    for (const name of written) await copyFile(join(packScratch, name), join(outputDir, name))
    return written
  } finally {
    await rm(stdinScratch, { recursive: true, force: true })
    await rm(packScratch, { recursive: true, force: true })
  }
}
