import type { NoticePort, ThreadId } from '@dltech/atlas-core'
import { readMetaSync, sessionDirectory, threadMetaFile, threadMetaSchema } from '@dltech/atlas-harness'

import { composeServeApp } from './compose-serve'
import type { WorkspaceReadiness } from './materialize-workspace'
import type { ServeApp, ServeCompose } from './serve-app'
import type { bootServeFiles } from './serve-boot'

type Booted = Awaited<ReturnType<typeof bootServeFiles>>

const storedThreadModel = (args: {
  driveHome: string
  threadId: ThreadId
}): { ref: string; effort?: string | undefined } | undefined => {
  const meta = readMetaSync({
    file: threadMetaFile({
      sessionDir: sessionDirectory({ home: args.driveHome, sessionId: args.threadId }),
      threadId: args.threadId,
    }),
    schema: threadMetaSchema,
  })
  if (meta === undefined || meta.modelRef === null) return undefined
  return { ref: meta.modelRef, effort: meta.modelEffort ?? undefined }
}

export function composeBootApp(args: {
  compose?: ServeCompose | undefined
  model?: { ref: string; effort?: string | undefined } | undefined
  spec: Booted['spec']
  workspace: WorkspaceReadiness
  context: Booted['context']
  threadId: ThreadId
  cwd: string
  driveHome: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  env: Record<string, string | undefined>
  notice: NoticePort
}): Promise<ServeApp> {
  const { spec } = args
  const model =
    args.model ??
    storedThreadModel(args) ??
    (spec?.model === undefined || spec.model === null ? undefined : { ref: spec.model })

  return (args.compose ?? composeServeApp)({
    threadId: args.threadId,
    cwd: args.cwd,
    controlPlaneUrl: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
    env: args.env,
    model,
    notice: args.notice,
    projectDirectory: args.context.projectDirectory,
    capabilities: 'profile' in args.workspace ? args.workspace.profile?.capabilities : undefined,
    identity: args.context.identity,
  })
}
