import { ComposerUploadBlobStore } from './composer-upload-blob-store'

export class FakeComposerUploadBlobStore extends ComposerUploadBlobStore {
  readonly uploaded = new Map<string, { size: number; uploadedAt: Date }>()
  readonly presigned: Array<{ pathname: string; maximumSizeInBytes: number }> = []
  readonly deleted: string[] = []

  reset(): void {
    this.uploaded.clear()
    this.presigned.length = 0
    this.deleted.length = 0
  }

  async presignUpload(args: { pathname: string; maximumSizeInBytes: number }) {
    this.presigned.push(args)
    return {
      uploadUrl: `https://blob.test/put/${args.pathname}`,
      validUntil: Date.now() + 900_000,
    }
  }

  async head(args: { pathname: string }) {
    const found = this.uploaded.get(args.pathname)
    return found === undefined ? null : { size: found.size }
  }

  async presignDownload(args: { pathname: string }) {
    return { downloadUrl: `https://blob.test/get/${args.pathname}?sig=1` }
  }

  async delete(args: { pathnames: string[] }): Promise<void> {
    for (const pathname of args.pathnames) {
      this.deleted.push(pathname)
      this.uploaded.delete(pathname)
    }
  }

  async listOlderThan(args: { prefix: string; before: Date }): Promise<string[]> {
    return [...this.uploaded]
      .filter(
        ([pathname, meta]) => pathname.startsWith(args.prefix) && meta.uploadedAt < args.before,
      )
      .map(([pathname]) => pathname)
  }
}
