import Link from 'next/link'

import type { ArtifactSummary } from '@dltech/atlas-wire'

import { relativeTime } from '@/features/settings/data/personal/relative-time'

import { formatBytes } from './artifact-format'
import { ArtifactStatusChip } from './artifact-status-chip'
import { artifactHrefOf } from './artifacts-path'
import { CopyButton } from './copy-button'

export function ArtifactRow({ artifact }: { artifact: ArtifactSummary }) {
  return (
    <li className="flex items-center gap-2 pr-3 transition-colors focus-within:bg-muted/50 hover:bg-muted/50">
      <Link
        href={artifactHrefOf(artifact.slug)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 outline-none"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{artifact.name}</span>
          <ArtifactStatusChip status={artifact.status} />
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{artifact.url}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">v{artifact.currentVersion}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{formatBytes(artifact.bytes)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">Updated {relativeTime({ from: artifact.updatedAt })}</span>
        </span>
      </Link>
      <CopyButton value={artifact.url} label={`Copy ${artifact.name} URL`} />
    </li>
  )
}
