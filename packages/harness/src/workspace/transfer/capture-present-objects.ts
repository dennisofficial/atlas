import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { captureGit } from './capture-git'

const MISSING = /^([0-9a-f]{40,64}) missing$/

export async function presentObjects({
  cwd,
  ids,
  scratchPrefix,
  subject,
}: {
  cwd: string
  ids: Iterable<string>
  scratchPrefix: string
  subject: string
}): Promise<string[]> {
  const wanted = [...ids]
  if (wanted.length === 0) return []
  const scratch = await mkdtemp(join(tmpdir(), scratchPrefix))
  try {
    const stdinPath = join(scratch, 'ids')
    await writeFile(stdinPath, `${wanted.join('\n')}\n`)
    const run = await captureGit({ args: ['cat-file', '--batch-check'], cwd, stdinPath })
    if (!run.ok) throw new Error(`Cannot check the ${subject} of ${cwd}: ${run.stderr.trim()}`)
    const absent = new Set(run.stdout.split('\n').flatMap((line) => MISSING.exec(line)?.[1] ?? []))
    return wanted.filter((id) => !absent.has(id))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
