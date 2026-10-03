import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { DirectoryEntry } from '@dltech/atlas-core'

import { safeRelativeSegment } from './safe-relative-path'

export const MAX_CONTEXT_ENTRIES = 500
export const MAX_CONTEXT_FILE_BYTES = 2 * 1024 * 1024

export type ContextFileContent =
  | { type: 'text'; content: string; truncated: boolean }
  | { type: 'refused'; reason: string }

export class ContextBrowser {
  private readonly root: string

  constructor(args: { root: string }) {
    this.root = args.root
  }

  async list(directory?: string): Promise<readonly DirectoryEntry[]> {
    const root = await this.resolve({ path: directory ?? '.' })
    if (root === null) return []
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => !entry.isSymbolicLink())
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_CONTEXT_ENTRIES)
  }

  async load(path: string): Promise<ContextFileContent> {
    const full = await this.resolve({ path })
    if (full === null) return { type: 'refused', reason: 'the file is missing or outside the context folder' }
    const found = await stat(full).catch(() => null)
    if (found === null) return { type: 'refused', reason: 'the file does not exist' }
    if (!found.isFile()) return { type: 'refused', reason: 'the path is not a file' }
    if (found.size > MAX_CONTEXT_FILE_BYTES) {
      return { type: 'refused', reason: 'the file exceeds the viewer’s 2 MiB limit' }
    }
    const read = await readFile(full).catch(() => null)
    if (read === null) return { type: 'refused', reason: 'the file could not be read' }
    if (read.includes(0)) return { type: 'refused', reason: 'the file is binary' }
    return { type: 'text', content: read.toString('utf8'), truncated: false }
  }

  private async resolve(args: { path: string }): Promise<string | null> {
    const raw = safeRelativeSegment(args.path)
    if (raw === null || raw.includes('\0')) return null
    const [base, target] = await Promise.all([
      this.realPath(this.root),
      this.realPath(join(this.root, raw)),
    ])
    if (base === null || target === null) return null
    return target === base || target.startsWith(`${base}/`) ? target : null
  }

  private async realPath(path: string): Promise<string | null> {
    return realpath(path).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    })
  }
}
