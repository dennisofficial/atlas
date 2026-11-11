import type { ArtifactBuild } from '@dltech/atlas-wire/web'

import { relativeTime } from '@/features/settings/data/personal/relative-time'

import { formatDuration } from './artifact-format'
import { ArtifactStatusChip } from './artifact-status-chip'

const COLLAPSE_LOG_LINES = 40

const LOG_CLASS =
  'overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap'

function BuildLog({ log }: { log: string }) {
  const lineCount = log.trimEnd().split('\n').length

  if (lineCount <= COLLAPSE_LOG_LINES) return <pre className={LOG_CLASS}>{log}</pre>

  return (
    <details className="rounded-lg bg-muted">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
        Show the full log ({lineCount} lines)
      </summary>
      <pre className={LOG_CLASS}>{log}</pre>
    </details>
  )
}

export function ArtifactBuildLog({ build }: { build: ArtifactBuild }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Last build</h2>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <ArtifactStatusChip status={build.status} />
        <span>{relativeTime({ from: build.updatedAt })}</span>
        <span aria-hidden>·</span>
        <span>took {formatDuration(build.durationMs)}</span>
      </div>
      {build.failure === null ? null : (
        <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {build.failure}
        </pre>
      )}
      {build.log === null ? null : <BuildLog log={build.log} />}
    </section>
  )
}
