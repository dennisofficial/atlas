import {
  ArtifactBlobStore,
  type ArtifactBlobHead,
  type ArtifactBlobSummary,
  type PresignedUpload,
} from './artifact-blob-store'

export class FakeArtifactBlobStore extends ArtifactBlobStore {
  readonly stored = new Map<string, { body: string | Buffer; contentType: string }>()
  readonly requestedUploads: string[] = []
  readonly deleted: string[] = []

  reset(): void {
    this.stored.clear()
    this.requestedUploads.length = 0
    this.deleted.length = 0
  }

  seed(args: { pathname: string; body?: string }): void {
    this.stored.set(args.pathname, {
      body: args.body ?? '',
      contentType: 'application/octet-stream',
    })
  }

  bodyOf(pathname: string): unknown {
    const blob = this.stored.get(pathname)
    if (blob === undefined || typeof blob.body !== 'string') return undefined
    return JSON.parse(blob.body)
  }

  async presignUpload(args: { pathname: string; maxBytes: number }): Promise<PresignedUpload> {
    this.requestedUploads.push(args.pathname)
    return { url: `https://blob.test/put/${args.pathname}`, validUntil: Date.now() + 900_000 }
  }

  async presignDownload(args: { pathname: string; ttlMs: number }): Promise<string> {
    return `https://blob.test/get/${args.pathname}?ttl=${args.ttlMs}`
  }

  async head(args: { pathname: string }): Promise<ArtifactBlobHead | null> {
    const blob = this.stored.get(args.pathname)
    if (blob === undefined) return null
    return { url: `https://blob.test/${args.pathname}`, size: blob.body.length }
  }

  async put(args: {
    pathname: string
    body: string | Buffer
    contentType: string
    allowOverwrite: boolean
  }): Promise<void> {
    if (!args.allowOverwrite && this.stored.has(args.pathname)) {
      throw new Error(`blob already exists: ${args.pathname}`)
    }
    this.stored.set(args.pathname, { body: args.body, contentType: args.contentType })
  }

  async read(args: { pathname: string }): Promise<Buffer | null> {
    const blob = this.stored.get(args.pathname)
    if (blob === undefined) return null
    return typeof blob.body === 'string' ? Buffer.from(blob.body) : blob.body
  }

  async delete(args: { pathname: string }): Promise<void> {
    this.deleted.push(args.pathname)
    this.stored.delete(args.pathname)
  }

  async remove(pathnames: readonly string[]): Promise<void> {
    for (const pathname of pathnames) await this.delete({ pathname })
  }

  async list(args: { prefix: string }): Promise<ArtifactBlobSummary[]> {
    return [...this.stored.entries()]
      .filter(([pathname]) => pathname.startsWith(args.prefix))
      .map(([pathname, blob]) => ({
        pathname,
        size: typeof blob.body === 'string' ? Buffer.byteLength(blob.body) : blob.body.length,
      }))
  }
}
