import { lstat, opendir } from 'node:fs/promises'
import { join } from 'node:path'

export const MAX_SCANNED_ENTRIES = 500

export type ContextSignature = { signature: string; capped: boolean }
export type ScannedEntry = { name: string; isDirectory: () => boolean }
export type OpenDirectory = (args: { path: string }) => Promise<AsyncIterable<ScannedEntry>>

const openDirectory: OpenDirectory = ({ path }) => opendir(path)

async function readBounded(args: { path: string; budget: number; open: OpenDirectory }) {
  const entries: ScannedEntry[] = []
  try {
    for await (const entry of await args.open({ path: args.path })) {
      if (entries.length >= args.budget) return { entries, capped: true }
      entries.push(entry)
    }
  } catch {
    return { entries, capped: false }
  }
  return { entries, capped: false }
}

export async function scanContextSignature(args: {
  context: string
  limit?: number
  open?: OpenDirectory
}): Promise<ContextSignature> {
  const limit = args.limit ?? MAX_SCANNED_ENTRIES
  const open = args.open ?? openDirectory
  const lines: string[] = []
  const pending = ['']
  let capped = false
  while (pending.length > 0 && !capped) {
    const relative = pending.shift() ?? ''
    const batch = await readBounded({ path: join(args.context, relative), budget: limit - lines.length, open })
    capped = batch.capped
    batch.entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of batch.entries) {
      const path = join(relative, entry.name)
      const stats = await lstat(join(args.context, path)).catch(() => null)
      lines.push(`${path}:${stats?.size ?? -1}:${stats?.mtimeMs ?? -1}`)
      if (entry.isDirectory()) pending.push(path)
    }
  }
  return { signature: lines.join('\n'), capped }
}
