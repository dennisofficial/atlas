import {
  EArchivePhase,
  createBuildProgressThrottle,
  type ArchiveBuildProgress,
  type ArchiveBuildReporter,
  type ArchiveProgressSignal,
} from '@dltech/atlas-harness'
import type { PrepareWorkspaceArchiveReply, SessionArchiveDescriptor } from '@dltech/atlas-wire'

export type ArchiveProgressFields = Omit<ArchiveProgressSignal, 'type'>

export type ArchiveBuildOptions = { onBuildProgress?: ArchiveBuildReporter | undefined }

export type SessionArchiveReader = (options?: ArchiveBuildOptions) => Promise<SessionArchiveDescriptor | null>

export type WorkspacePreparer = (options?: ArchiveBuildOptions) => Promise<PrepareWorkspaceArchiveReply>

const PHASES = {
  walking: EArchivePhase.Walking,
  staging: EArchivePhase.Staging,
  compressing: EArchivePhase.Compressing,
} satisfies Record<ArchiveBuildProgress['phase'], EArchivePhase>

const fieldsOf = (args: {
  archive: ArchiveProgressFields['archive']
  progress: ArchiveBuildProgress
}): ArchiveProgressFields => ({
  archive: args.archive,
  phase: PHASES[args.progress.phase],
  files: args.progress.files,
  bytes: args.progress.bytes,
  ...(args.progress.totalBytes === undefined ? {} : { totalBytes: args.progress.totalBytes }),
})

export function archiveProgressReporter(args: {
  archive: ArchiveProgressFields['archive']
  broadcast: ((progress: ArchiveProgressFields) => void) | undefined
  intervalMs?: number | undefined
}): ArchiveBuildReporter | undefined {
  const { archive, broadcast } = args
  if (broadcast === undefined) return undefined
  const throttles = new Map<ArchiveBuildProgress['phase'], ArchiveBuildReporter>()
  return (progress) => {
    let throttle = throttles.get(progress.phase)
    if (throttle === undefined) {
      throttle = createBuildProgressThrottle({
        report: (next) => broadcast(fieldsOf({ archive, progress: next })),
        intervalMs: args.intervalMs,
      })
      throttles.set(progress.phase, throttle)
    }
    throttle(progress)
  }
}
