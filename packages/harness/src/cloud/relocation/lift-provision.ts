import { cloudWorkspacePath } from '@dltech/atlas-wire'

import type { WorkspaceManifest } from '../../workspace/transfer/manifest'
import { ELiftNode, type LiftCtx } from './lift-plan'

export const workspaceDirectoryOf = ({ manifest }: { manifest: WorkspaceManifest }): string | undefined => {
  const primary = manifest.repository?.originPath ?? manifest.trees.find((tree) => tree.isMain)?.originPath
  if (primary === undefined) return undefined
  return cloudWorkspacePath({ sourcePath: primary })
}

export const provisionLiftSandbox = async (ctx: LiftCtx): Promise<void> => {
  const workspaceDirectory =
    ctx.workspaceArchive === undefined ? undefined : workspaceDirectoryOf({ manifest: ctx.workspaceArchive.manifest })
  ctx.sandbox = await ctx.args.bridge.sandboxes.create({
    threadId: ctx.args.threadId,
    workspace: ctx.workspace,
    ...(ctx.workspaceArchive === undefined ? {} : { workspaceArchivePath: ctx.workspaceArchive.path }),
    ...(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
    model: ctx.args.model.ref,
    onTransferProgress: (progress) => ctx.args.onTransferProgress?.({ ...progress, nodeId: ELiftNode.Provision }),
    ...(ctx.transcript === undefined ? {} : { transcriptArchivePath: ctx.transcript.path }),
    ...(ctx.gpgKey === undefined ? {} : { gpgKey: ctx.gpgKey }),
    captureContext: async (put) => {
      ctx.onWaveLabel?.(ELiftNode.Provision, 'sending skills and memory to the sandbox')
      try {
        const archive = await ctx.args.captureContext()
        if (archive !== undefined) await put(archive)
      } catch (error) {
        ctx.contextError = error
        throw error
      } finally {
        ctx.onWaveLabel?.(ELiftNode.Provision, 'waiting for the sandbox')
      }
    },
  })
}
