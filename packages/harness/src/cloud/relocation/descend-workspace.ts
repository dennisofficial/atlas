import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EClientRequest, prepareWorkspaceArchiveReplySchema } from '../channel-wire'
import { EWorkspaceRestoreMode, prepareWorkspaceRestoration, type WorkspaceRestoration } from '../../workspace/transfer/restore'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import type { LogPort, ThreadId } from '@dltech/atlas-core'
import { logFieldsOf } from '../../store/logs'

export type WorkspaceRestorer = (args: Parameters<typeof prepareWorkspaceRestoration>[0]) => Promise<RestoredWorkspace | WorkspaceRestoration>

export async function restoreCloudWorkspace(args: {
  threadId: ThreadId
  channel: CloudChannel
  bridge: CloudBridge
  destination: string
  restore?: WorkspaceRestorer | undefined
  logPort?: LogPort | undefined
  beforeRestore?: (() => Promise<void>) | undefined
}): Promise<WorkspaceRestoration> {
  const download = args.bridge.sandboxes.downloadWorkspace
  if (download === undefined) throw new Error('the cloud bridge cannot download a workspace archive; the session remains in the cloud')
  const reply = prepareWorkspaceArchiveReplySchema.parse(await args.channel.request({
    op: EClientRequest.PrepareWorkspaceArchive,
    params: {},
  }))
  const directory = await mkdtemp(join(tmpdir(), 'atlas-descend-workspace-'))
  const archivePath = join(directory, 'workspace.tar.gz')
  try {
    await download({ threadId: args.threadId, path: reply.path, destination: archivePath })
    await args.beforeRestore?.()
    const restored = await (args.restore ?? prepareWorkspaceRestoration)({
      archivePath,
      destination: args.destination,
      mode: EWorkspaceRestoreMode.Host,
    })
    if ('restored' in restored) return restored
    return { restored, commit: async () => undefined, rollback: async () => undefined }
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
