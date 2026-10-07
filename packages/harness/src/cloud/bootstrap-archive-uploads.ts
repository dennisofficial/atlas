import {
  TRANSCRIPT_ARCHIVE_PATH,
  WORKSPACE_ARCHIVE_PATH,
  type BridgeDriver,
  type LiveSandbox,
} from './local-cloud-bootstrap'
import type { SandboxTransferProgress } from './transfer-progress'

type ArchiveUpload = {
  source: string
  destination: string
  transferId: string
  label: string
}

export async function uploadBootstrapArchives(args: {
  driver: Pick<BridgeDriver, 'uploadWorkspaceArchive'>
  sandbox: LiveSandbox
  transcriptArchivePath: string | undefined
  workspaceArchivePath: string | undefined
  onTransferProgress: ((progress: SandboxTransferProgress) => void) | undefined
}): Promise<void> {
  const uploads: ArchiveUpload[] = []
  if (args.transcriptArchivePath !== undefined) {
    uploads.push({
      source: args.transcriptArchivePath,
      destination: TRANSCRIPT_ARCHIVE_PATH,
      transferId: 'transcript-upload',
      label: 'uploading conversation',
    })
  }
  if (args.workspaceArchivePath !== undefined) {
    uploads.push({
      source: args.workspaceArchivePath,
      destination: WORKSPACE_ARCHIVE_PATH,
      transferId: 'workspace-upload',
      label: 'uploading workspace',
    })
  }

  const settled = await Promise.allSettled(
    uploads.map(async (upload) =>
      args.driver.uploadWorkspaceArchive({
        sandbox: args.sandbox,
        source: upload.source,
        destination: upload.destination,
        onProgress: (progress) =>
          args.onTransferProgress?.({ ...progress, transferId: upload.transferId, label: upload.label }),
      }),
    ),
  )
  for (const outcome of settled) {
    if (outcome.status === 'rejected') throw outcome.reason
  }
}
