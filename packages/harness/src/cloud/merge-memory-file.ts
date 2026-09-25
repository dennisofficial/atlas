import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { MEMORY_INDEX_NAME } from '@dltech/atlas-core'

export type RemoteMemoryConflict = { key: string; text: string }

export type MergeCandidate = { key: string; mtime: number; readBytes: () => Promise<Buffer> }

const localMtimeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

const unionIndex = (args: { held: string; incoming: string }): string | null => {
  const lines = args.held.split('\n')
  const seen = new Set(lines)
  const additions = args.incoming
    .split('\n')
    .filter((line) => line.trim() !== '' && !seen.has(line))
  if (additions.length === 0) return null

  const base = args.held === '' || args.held.endsWith('\n') ? args.held : `${args.held}\n`
  return `${base}${additions.join('\n')}\n`
}

export type Applied = { replaced: boolean; conflict: RemoteMemoryConflict | null }

/**
 * The index is never a conflict: both sides append lines, so the merge is the union. Any other
 * file the local side touched since the cloud wrote (or at the same moment) stays local — the
 * host always wins — and the cloud's version comes back as a conflict for the descend report
 * rather than being silently dropped.
 */
export const applyOne = async (args: {
  candidate: MergeCandidate
  target: string
}): Promise<Applied> => {
  const remote = await args.candidate.readBytes()
  const localMtime = await localMtimeOf(args.target)

  if (localMtime !== null && basename(args.target) === MEMORY_INDEX_NAME) {
    const merged = unionIndex({
      held: await readFile(args.target, 'utf8'),
      incoming: remote.toString('utf8'),
    })
    if (merged === null) return { replaced: false, conflict: null }
    await writeFile(args.target, merged, 'utf8')
    return { replaced: true, conflict: null }
  }

  if (localMtime === null || localMtime < args.candidate.mtime) {
    await mkdir(join(args.target, '..'), { recursive: true })
    await writeFile(args.target, remote)
    return { replaced: true, conflict: null }
  }

  const held = await readFile(args.target)
  if (held.equals(remote)) return { replaced: false, conflict: null }
  return { replaced: false, conflict: { key: args.candidate.key, text: remote.toString('utf8') } }
}
