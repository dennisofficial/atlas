export abstract class ComposerUploadBlobStore {
  abstract presignUpload(args: {
    pathname: string
    maximumSizeInBytes: number
  }): Promise<{ uploadUrl: string; validUntil: number }>
  abstract head(args: { pathname: string }): Promise<{ size: number } | null>
  abstract presignDownload(args: { pathname: string }): Promise<{ downloadUrl: string }>
  abstract delete(args: { pathnames: string[] }): Promise<void>
  abstract listOlderThan(args: { prefix: string; before: Date }): Promise<string[]>
}
