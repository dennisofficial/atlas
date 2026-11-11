import type { ArtifactVersionSummary } from '@dltech/atlas-wire/web'

import { relativeTime } from '@/features/settings/data/personal/relative-time'

import { versionsNewestFirst } from './artifact-format'
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

export function ArtifactLogs({ versions }: { versions: readonly ArtifactVersionSummary[] }) {
  const ordered = versionsNewestFirst(versions)

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Build logs</h2>
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">This artifact has no builds yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {ordered.map((version) => (
            <li key={version.version} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">v{version.version}</span>
                <ArtifactStatusChip status={version.status} />
                <span className="shrink-0">{relativeTime({ from: version.createdAt })}</span>
              </div>
              {version.failure === null ? null : (
                <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
                  {version.failure}
                </pre>
              )}
              {version.log === null ? null : <BuildLog log={version.log} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
