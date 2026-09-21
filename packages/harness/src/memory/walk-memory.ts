import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type MemoryWalkEntry = { name: string; content: string; mtime: number }

/**
 * A flat, non-recursive walk of one memory directory: `content` is base64 so any byte sequence
 * round-trips, and a directory that does not exist (or a file that vanishes mid-walk) is skipped
 * rather than failing the whole capture. Shared by the sandbox's own upload (which keys by
 * `user/`/`project/`) and the Mac's context bundle (which keys by `.atlas/memory/`/
 * `project-memory/`) — the wire vocabulary is each caller's own, only the walk is common.
 */
export async function walkMemoryDirectory(directory: string): Promise<readonly MemoryWalkEntry[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const files: MemoryWalkEntry[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(directory, entry.name)
    try {
      const [content, stats] = await Promise.all([readFile(path), stat(path)])
      files.push({ name: entry.name, content: content.toString('base64'), mtime: stats.mtimeMs })
    } catch {
      continue
    }
  }

  return files
}
