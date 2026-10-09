export type ArchiveBuildProgress = {
  phase: 'walking' | 'staging' | 'compressing'
  files: number
  bytes: number
  totalBytes?: number | undefined
}

export type ArchiveBuildReporter = (progress: ArchiveBuildProgress) => void

const NEVER = -1

export function createBuildProgressThrottle(args: {
  report: ArchiveBuildReporter
  intervalMs?: number | undefined
  now?: (() => number) | undefined
}): ArchiveBuildReporter {
  const intervalMs = args.intervalMs ?? 250
  const now = args.now ?? (() => Date.now())
  let lastEmitted = NEVER
  let lastKey = ''
  return (progress) => {
    const key = `${progress.phase}:${progress.files}:${progress.bytes}:${progress.totalBytes ?? ''}`
    if (key === lastKey) return
    const at = now()
    if (lastEmitted !== NEVER && at - lastEmitted < intervalMs) return
    lastEmitted = at
    lastKey = key
    try {
      args.report(progress)
    } catch {
      // A reporter must never abort the archive it is describing.
    }
  }
}
