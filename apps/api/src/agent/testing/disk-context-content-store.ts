import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { type ChangeBlobRow, ContextContentStore } from '@dltech/atlas-control'

export class DiskContextContentStore extends ContextContentStore {
  private readonly root: string

  constructor(args: { root: string }) {
    super()
    this.root = args.root
  }

  async put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    mkdirSync(this.root, { recursive: true })
    writeFileSync(this.pathOf(args.hash), Buffer.from(args.bytes))
  }

  async read(args: { hash: string }): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(readFileSync(this.pathOf(args.hash)))
    } catch {
      return null
    }
  }

  async presignGet(args: { hash: string }): Promise<string> {
    return `file://${this.pathOf(args.hash)}`
  }

  async removing(hashes: readonly string[]): Promise<void> {
    for (const hash of hashes) rmSync(this.pathOf(hash), { force: true })
  }

  async list(): Promise<readonly ChangeBlobRow[]> {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root).map((hash) => {
      const stat = statSync(this.pathOf(hash))
      return { hash, size: stat.size, createdAt: stat.mtimeMs }
    })
  }

  private pathOf(hash: string): string {
    return join(this.root, hash)
  }
}
