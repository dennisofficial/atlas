export interface PresignedUpload {
  uploadUrl: string
  validUntil: number
}

export interface BlobHead {
  url: string
  size: number
}

export abstract class BundleBlobStore {
  abstract presignUpload(args: { pathname: string }): Promise<PresignedUpload>
  abstract head(args: { pathname: string }): Promise<BlobHead | null>
  abstract presignDownload(args: { pathname: string }): Promise<{ downloadUrl: string }>
}
