export interface PresignedUpload {
  url: string
  validUntil: number
}

export interface ArtifactBlobHead {
  url: string
  size: number
}

export interface ArtifactBlobSummary {
  pathname: string
  size: number
}

export abstract class ArtifactBlobStore {
  abstract presignUpload(args: { pathname: string; maxBytes: number }): Promise<PresignedUpload>
  abstract presignDownload(args: { pathname: string; ttlMs: number }): Promise<string>
  abstract head(args: { pathname: string }): Promise<ArtifactBlobHead | null>
  abstract put(args: {
    pathname: string
    body: string | Buffer
    contentType: string
    allowOverwrite: boolean
  }): Promise<void>
  abstract read(args: { pathname: string }): Promise<Buffer | null>
  abstract delete(args: { pathname: string }): Promise<void>
  abstract remove(pathnames: readonly string[]): Promise<void>
  abstract list(args: { prefix: string }): Promise<ArtifactBlobSummary[]>
}
