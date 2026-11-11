import type { ArtifactStatus } from '@dltech/atlas-wire/web'

import { Badge } from '@dltech/atlas-ui/components/badge'

import { statusLabelOf, statusVariantOf } from './artifact-format'

export function ArtifactStatusChip({ status }: { status: ArtifactStatus }) {
  return (
    <Badge variant={statusVariantOf(status)} aria-label={`Status ${statusLabelOf(status)}`}>
      {statusLabelOf(status)}
    </Badge>
  )
}
