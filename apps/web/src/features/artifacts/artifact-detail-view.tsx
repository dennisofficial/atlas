'use client'

import type { ArtifactGetOutput } from '@dltech/atlas-wire'

import { QueryGate } from '@/features/settings/data/shared/query-gate'
import { useRouteParam } from '@/lib/route-param'
import { useCloudQuery } from '@/lib/use-cloud-query'

import { useArtifactActions } from './artifact-actions'
import { rollbackTargetOf } from './artifact-format'
import { ArtifactFiles } from './artifact-files'
import { ArtifactHeader } from './artifact-header'
import { ArtifactHistory, ArtifactMetadata } from './artifact-history'
import { ArtifactLogs } from './artifact-logs'
import { ArtifactDetailSkeleton } from './artifact-skeletons'
import { artifactKeyOf, fetchArtifact } from './artifacts-api'

export function ArtifactDetail({ data, reload }: { data: ArtifactGetOutput; reload: () => void }) {
  const { artifact, versions, current } = data
  const actions = useArtifactActions({ slug: artifact.slug, reload })
  const rollbackTarget = rollbackTargetOf({
    versions,
    current: artifact.currentVersion,
  })

  return (
    <div className="flex flex-col gap-6">
      <ArtifactHeader
        artifact={artifact}
        rollbackTarget={rollbackTarget}
        busy={actions.busy}
        onRollback={(version) => void actions.handleRollback(version)}
        onUnpublish={() => void actions.handleUnpublish()}
      />
      <ArtifactFiles artifact={artifact} manifest={current} />
      <ArtifactLogs versions={versions} />
      <ArtifactMetadata artifact={artifact} />
      <ArtifactHistory
        artifact={artifact}
        versions={versions}
        busy={actions.busy}
        onRollback={(version) => void actions.handleRollback(version)}
      />
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
          {(data) => <ArtifactDetail data={data} reload={query.reload} />}
        </QueryGate>
      </div>
    </div>
  )
}
