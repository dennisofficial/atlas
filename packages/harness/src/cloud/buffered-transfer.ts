import type { TransferProgress } from './transfer-progress'

export async function transferBufferedArchive(args: {
  archive: Uint8Array
  upload: () => Promise<void>
  onProgress?: ((progress: TransferProgress) => void) | undefined
}): Promise<void> {
  const totalBytes = args.archive.byteLength
  args.onProgress?.({ transferredBytes: 0, totalBytes, complete: false })
  await args.upload()
  args.onProgress?.({ transferredBytes: totalBytes, totalBytes, complete: true })
}
