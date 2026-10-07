import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EClientRequest, prepareWorkspaceArchiveReplySchema, confirmWorkspaceCleanupReplySchema } from '../channel-wire'
import { EWorkspaceRestoreMode, prepareWorkspaceRestoration, type WorkspaceRestoration } from '../../workspace/transfer/restore'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import type { LogPort, ThreadId } from '@dltech/atlas-core'
import { logFieldsOf } from '../../store/logs'
import type { TransferProgress } from '../transfer-progress'
import { describeArchiveFile } from '../archive-file'
import type { SourceCleanupVerdict } from '../../workspace/transfer/cleanup-proof'
import { verifyFamilyRestoration } from '../../workspace/transfer/family-restoration-proof'

export type CloudWorkspaceRestoration = WorkspaceRestoration & {
  cleanup?: { sourceSessionId: string; verify: () => Promise<SourceCleanupVerdict> } | undefined
}

export type WorkspaceRestorer = (args: Parameters<typeof prepareWorkspaceRestoration>[0]) => Promise<RestoredWorkspace | WorkspaceRestoration>

export async function restoreCloudWorkspace(args: {
  threadId: ThreadId
  channel: CloudChannel
  bridge: CloudBridge
  destination: string
  restore?: WorkspaceRestorer | undefined
  logPort?: LogPort | undefined
  beforeRestore?: (() => Promise<void>) | undefined
  onProgress?: ((progress: TransferProgress) => void) | undefined
}): Promise<CloudWorkspaceRestoration> {
  const download = args.bridge.sandboxes.downloadWorkspace
  if (download === undefined) throw new Error('the cloud bridge cannot download a workspace archive; the session remains in the cloud')
  const reply = prepareWorkspaceArchiveReplySchema.parse(await args.channel.request({
    op: EClientRequest.PrepareWorkspaceArchive,
    params: {},
  }))
  if (reply.manifest.family !== undefined && reply.sha256 === undefined) throw new Error('the family workspace export carried no archive digest')
  const directory = await mkdtemp(join(tmpdir(), 'atlas-descend-workspace-'))
  const archivePath = join(directory, 'workspace.tar.gz')
  try {
    await download({
      threadId: args.threadId,
      path: reply.path,
      destination: archivePath,
      totalBytes: reply.totalBytes,
      onProgress: args.onProgress,
    })
    if (reply.sha256 !== undefined) {
      const downloaded = await describeArchiveFile({ path: archivePath })
      if (downloaded.sha256 !== reply.sha256 || reply.totalBytes !== undefined && downloaded.size !== reply.totalBytes) throw new Error('the downloaded workspace archive did not match its source digest')
    }
    await args.beforeRestore?.()
    const restored = await (args.restore ?? prepareWorkspaceRestoration)({
      archivePath,
      destination: args.destination,
      mode: EWorkspaceRestoreMode.Host,
    })
    const restoration = 'restored' in restored ? restored : { restored, commit: async () => undefined, rollback: async () => undefined }
    try {
      verifyFamilyRestoration({ manifest: reply.manifest, restored: restoration.restored })
    } catch (error) {
      await restoration.rollback()
      throw error
    }
    const candidate = reply.cleanup
    if (candidate === undefined && restoration.restored.family === undefined) return restoration
    return {
      ...restoration,
      cleanup: {
        sourceSessionId: candidate?.sourceSessionId ?? '',
        verify: async () => {
          if (candidate === undefined) return { safe: false, reasons: ['the family export carried no source cleanup proof'] }
          if (!candidate.safe || candidate.sourceSessionId.length === 0) return { safe: false, reasons: candidate.reasons.length === 0 ? ['the source runtime identity was not proven'] : candidate.reasons }
          const verdict = confirmWorkspaceCleanupReplySchema.parse(await args.channel.request({ op: EClientRequest.ConfirmWorkspaceCleanup, params: { generation: candidate.generation } }))
          if (verdict.sourceSessionId !== candidate.sourceSessionId) return { safe: false, reasons: ['the source provider session changed after export'] }
          return verdict
        },
      },
    }
  } finally {
    await args.bridge.sandboxes.releaseWorkspace?.({ threadId: args.threadId, path: reply.path }).catch((error: unknown) => {
      args.logPort?.warn({
        source: 'cloud.descend',
        threadId: args.threadId,
        message: 'the downloaded workspace export could not be removed from the sandbox',
        ...logFieldsOf({ error }),
      })
    })
    await rm(directory, { recursive: true, force: true })
  }
}
