import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const MAX_SCANNED_ENTRIES = 500

export type ContextSignature = { signature: string; capped: boolean }

export async function scanContextSignature(args: { context: string; limit?: number }): Promise<ContextSignature> {
  const limit = args.limit ?? MAX_SCANNED_ENTRIES
  const lines: string[] = []
  const pending = ['']
  let capped = false
  while (pending.length > 0 && !capped) {
    const relative = pending.shift() ?? ''
    const entries = await readdir(join(args.context, relative), { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (lines.length >= limit) { capped = true; break }
      const path = join(relative, entry.name)
      const stats = await lstat(join(args.context, path)).catch(() => null)
      lines.push(`${path}:${stats?.size ?? -1}:${stats?.mtimeMs ?? -1}`)
      if (entry.isDirectory()) pending.push(path)
    }
  }
  return { signature: lines.join('\n'), capped }
}
