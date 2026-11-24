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

import {
  type ChangeBlobRow,
  ContextContentStore,
  type PresignGetArgs,
  type PresignPutArgs,
} from '@dltech/atlas-control'

const HASH_PATH = /^\/([0-9a-f]{64})$/

export class DiskContextContentStore extends ContextContentStore {
  private readonly root: string
  private uploads: ReturnType<typeof Bun.serve> | null = null

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

  async presignGet(args: PresignGetArgs): Promise<string> {
    return `file://${this.pathOf(args.hash)}`
  }

  async presignPut(args: PresignPutArgs): Promise<string> {
    return `http://127.0.0.1:${this.uploadServer().port}/${args.hash}`
  }

  async exists(args: { hash: string }): Promise<boolean> {
    return existsSync(this.pathOf(args.hash))
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

  private uploadServer(): ReturnType<typeof Bun.serve> {
    if (this.uploads !== null) return this.uploads
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (request) => {
        const match = HASH_PATH.exec(new URL(request.url).pathname)
        if (request.method !== 'PUT' || match === null || match[1] === undefined) {
          return new Response(null, { status: 404 })
        }
        await this.put({ hash: match[1], bytes: new Uint8Array(await request.arrayBuffer()) })
        return new Response(null, { status: 200 })
      },
    })
    server.unref()
    this.uploads = server
    return server
  }
}
