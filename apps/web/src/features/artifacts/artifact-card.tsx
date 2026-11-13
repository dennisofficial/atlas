import Link from 'next/link'

import type { ArtifactSummary } from '@dltech/atlas-wire/web'

import { relativeTime } from '@/features/settings/data/personal/relative-time'

import { ArtifactPreview, EPreviewMode } from './artifact-preview'
import { ArtifactStatusChip } from './artifact-status-chip'
import { artifactHrefOf } from './artifacts-path'
import { CopyButton } from './copy-button'

export function ArtifactCard({ artifact }: { artifact: ArtifactSummary }) {
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors focus-within:border-ring/60 hover:border-ring/60">
      <ArtifactPreview
        url={artifact.url}
        name={artifact.name}
        mode={EPreviewMode.Thumbnail}
        className="aspect-[16/10] w-full rounded-none border-0 border-b border-border"
      />
      <div className="flex min-w-0 flex-col gap-1 p-3 pr-11">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{artifact.name}</span>
          <ArtifactStatusChip status={artifact.status} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{artifact.url}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">Updated {relativeTime({ from: artifact.updatedAt })}</span>
        </div>
      </div>
      <Link
        href={artifactHrefOf(artifact.subdomain)}
        aria-label={`Open ${artifact.name}`}
        className="absolute inset-0 rounded-xl outline-none"
      />
      <div className="absolute right-2 top-2 z-10">
        <CopyButton value={artifact.url} label={`Copy ${artifact.name} URL`} />
      </div>
    </li>
  )
}
