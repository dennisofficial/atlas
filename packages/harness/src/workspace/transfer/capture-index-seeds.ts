import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureGit } from './capture-git'

const GITLINK_MODE = '160000'
const STAGE_ENTRY = /^(\d+) ([0-9a-f]{40,64}) \d\t/
const MISSING = /^[0-9a-f]{40,64} missing$/

async function presentObjects({ cwd, ids }: { cwd: string; ids: readonly string[] }): Promise<string[]> {
  if (ids.length === 0) return []
  const scratch = await mkdtemp(join(tmpdir(), 'atlas-index-seeds-'))
  try {
    const stdinPath = join(scratch, 'ids')
    await writeFile(stdinPath, `${ids.join('\n')}\n`)
    const run = await captureGit({ args: ['cat-file', '--batch-check'], cwd, stdinPath })
    if (!run.ok) throw new Error(`Cannot check the indexed objects of ${cwd}: ${run.stderr.trim()}`)
    const absent = new Set(run.stdout.split('\n').filter((line) => MISSING.test(line)).map((line) => line.split(' ')[0]))
    return ids.filter((id) => !absent.has(id))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function indexedObjectSeeds({ cwd }: { cwd: string }): Promise<string[]> {
  const run = await captureGit({ args: ['ls-files', '--stage', '-z'], cwd })
  if (!run.ok) throw new Error(`Cannot read the git index of ${cwd}: ${run.stderr.trim()}`)
  const ids = new Set<string>()
  for (const entry of run.stdout.split('\0')) {
    const match = STAGE_ENTRY.exec(entry)
    if (match?.[1] !== undefined && match[2] !== undefined && match[1] !== GITLINK_MODE) ids.add(match[2])
  }
  return presentObjects({ cwd, ids: [...ids] })
}
