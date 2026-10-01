import { bootstrapServe, type ServeArgs } from './serve-bootstrap'
import { runServeRuntime, type ServeHandle } from './serve-runtime'

export * from './drive-bootstrap'
export * from './channel-bridge'
export * from './compose-serve'
export * from './drain-deadline'
export * from './environment-profile'
export * from './frame-buffer'
export * from './git-access-env'
export * from './idle-stop'
export * from './requests'
export * from './rewind-apply'
export * from './run-command'
export * from './serve-app'
export * from './serve-bootstrap'
export * from './serve-config'
export * from './portable-state'
export * from './serve-log'
export * from './serve-runtime'
export * from './session-server'
export * from './socket-session'
export * from './startup-recovery'
export * from './step-alias'
export * from './materialize-workspace'
export * from './materialize-transcript'
export * from './restore-transcript'
export * from './transcript-bootstrap'
export * from './placement-hydration'
export * from './publish-workspace'
export * from './token-guard'
export * from './turn-driver'
export * from './workspace-files'
export * from './workspace-spec'

export type { ServeArgs, ServeHandle }

export async function startServe(args: ServeArgs = {}): Promise<ServeHandle> {
  const bootstrap = await bootstrapServe(args)
  return runServeRuntime({
    bootstrap,
    stopSandbox: args.stopSandbox,
    exit: args.exit,
    bufferSize: args.bufferSize,
    drainDeadlineMs: args.drainDeadlineMs,
    idleMinutes: args.idleMinutes,
    idleTickMs: args.idleTickMs,
    publishWorkspace: args.publishWorkspace,
    fetchTranscriptArchive: args.fetchTranscriptArchive,
  })
}
