'use client'

import { AppWindowIcon } from 'lucide-react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@dltech/atlas-ui/components/empty'
import type { ArtifactSummary } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { artifactsNewestFirst } from './artifact-format'
import { ArtifactRow } from './artifact-row'
import { ARTIFACT_LIST_CLASS, ArtifactListSkeleton } from './artifact-skeletons'
import { ARTIFACTS_KEY, fetchArtifacts } from './artifacts-api'

export function ArtifactList({ artifacts }: { artifacts: readonly ArtifactSummary[] }) {
  return (
    <ul className={ARTIFACT_LIST_CLASS}>
      {artifactsNewestFirst(artifacts).map((artifact) => (
        <ArtifactRow key={artifact.subdomain} artifact={artifact} />
      ))}
    </ul>
  )
}

export function NoArtifacts() {
  return (
    <Empty variant="outline">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AppWindowIcon />
        </EmptyMedia>
        <EmptyTitle>No artifacts yet</EmptyTitle>
        <EmptyDescription>
          An artifact is a static build an agent publishes for you, served on its own URL. Ask an
          agent in a thread to publish one and it appears here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function ArtifactsView() {
  const query = useCloudQuery({ key: ARTIFACTS_KEY, load: fetchArtifacts })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-16">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-medium tracking-tight">Artifacts</h1>
        </header>
        <QueryGate query={query} label="artifacts" skeleton={<ArtifactListSkeleton />}>
          {(data) =>
            data.artifacts.length === 0 ? (
              <NoArtifacts />
            ) : (
              <ArtifactList artifacts={data.artifacts} />
            )
          }
        </QueryGate>
      </div>
    </div>
  )
}
