'use client'

import { RotateCcwIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import type { ArtifactSummary, ArtifactVersionSummary } from '@dltech/atlas-wire/web'

import { shortDate } from '@/features/settings/data/personal/relative-time'

import { formatBytes, versionsNewestFirst } from './artifact-format'
import { ArtifactStatusChip } from './artifact-status-chip'

const SHORT_HASH_LENGTH = 12

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono">{children}</dd>
    </>
  )
}

function HashValue({ hash }: { hash: string | null }) {
  if (hash === null) return <span className="text-muted-foreground">—</span>
  return <span title={hash}>{hash.slice(0, SHORT_HASH_LENGTH)}</span>
}

export function ArtifactMetadata({ artifact }: { artifact: ArtifactSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Metadata</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-border px-4 py-3 text-xs">
        <DetailRow label="Slug">{artifact.slug}</DetailRow>
        <DetailRow label="Status">{artifact.status}</DetailRow>
        <DetailRow label="Current version">v{artifact.currentVersion}</DetailRow>
        <DetailRow label="Size">{formatBytes(artifact.bytes)}</DetailRow>
        <DetailRow label="Files">{artifact.fileCount}</DetailRow>
        <DetailRow label="Source hash">
          <HashValue hash={artifact.sourceHash} />
        </DetailRow>
        <DetailRow label="Spec hash">
          <HashValue hash={artifact.specHash} />
        </DetailRow>
        <DetailRow label="Created">{shortDate(artifact.createdAt)}</DetailRow>
        <DetailRow label="Updated">{shortDate(artifact.updatedAt)}</DetailRow>
      </dl>
    </section>
  )
}

export function ArtifactHistory({
  artifact,
  versions,
  busy,
  onRollback,
}: {
  artifact: ArtifactSummary
  versions: readonly ArtifactVersionSummary[]
  busy: boolean
  onRollback: (version: number) => void
}) {
  const ordered = versionsNewestFirst(versions)

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Versions</h2>
      {ordered.length === 0 ? (
        <p className="text-xs text-muted-foreground">This artifact has no versions yet.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {ordered.map((version) => {
            const current = version.version === artifact.currentVersion
            return (
              <li key={version.version} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                <span className="font-medium">v{version.version}</span>
                <ArtifactStatusChip status={version.status} />
                <span className="shrink-0 text-muted-foreground">
                  {shortDate(version.createdAt)}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(version.bytes)}</span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline">
                  {version.fileCount} files
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  disabled={current || version.status !== 'ready' || busy}
                  onClick={() => onRollback(version.version)}
                >
                  <RotateCcwIcon data-icon="inline-start" />
                  Rollback to v{version.version}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
