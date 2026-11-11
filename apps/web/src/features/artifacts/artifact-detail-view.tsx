'use client'

import type { ArtifactGetOutput } from '@dltech/atlas-wire/web'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { useRouteParam } from '@/lib/route-param'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { useArtifactActions } from './artifact-actions'
import { ArtifactHeader } from './artifact-header'
import { ArtifactBuildLog } from './artifact-logs'
import { ArtifactDetailSkeleton } from './artifact-skeletons'
import { artifactKeyOf, fetchArtifact } from './artifacts-api'

export function ArtifactDetail({ data }: { data: ArtifactGetOutput }) {
  const { artifact, build } = data
  const actions = useArtifactActions({ ref: artifact.subdomain })

  return (
    <div className="flex flex-col gap-6">
      <ArtifactHeader
        artifact={artifact}
        busy={actions.busy}
        onUnpublish={() => void actions.handleUnpublish()}
      />
      <ArtifactBuildLog build={build} />
    </div>
  )
}

export function ArtifactDetailView() {
  const slug = useRouteParam('slug')
  const query = useCloudQuery({
    key: artifactKeyOf(slug),
    load: () => fetchArtifact(slug),
  })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10">
        <QueryGate query={query} label="this artifact" skeleton={<ArtifactDetailSkeleton />}>
          {(data) => <ArtifactDetail data={data} />}
        </QueryGate>
      </div>
    </div>
  )
}
