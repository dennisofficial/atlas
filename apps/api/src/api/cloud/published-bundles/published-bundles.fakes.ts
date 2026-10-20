import { BundleBlobStore, type BlobHead, type PresignedUpload } from './blob-store'

export class FakeBundleBlobStore extends BundleBlobStore {
  readonly uploaded = new Map<string, number>()
  readonly presigned: string[] = []

  reset(): void {
    this.uploaded.clear()
    this.presigned.length = 0
  }

  async presignUpload(args: { pathname: string }): Promise<PresignedUpload> {
    this.presigned.push(args.pathname)
    return { uploadUrl: `https://blob.test/put/${args.pathname}`, validUntil: Date.now() + 900_000 }
  }

  async head(args: { pathname: string }): Promise<BlobHead | null> {
    const size = this.uploaded.get(args.pathname)
    return size === undefined ? null : { url: `https://blob.test/${args.pathname}`, size }
  }

  async presignDownload(args: { pathname: string }): Promise<{ downloadUrl: string }> {
    return { downloadUrl: `https://blob.test/get/${args.pathname}?sig=1` }
  }
}
