import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'
import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ServerIcon } from 'lucide-react'

import { RUNNING_POD, simulateResize } from '../pod-status'

export function PodSection() {
  return (
    <section aria-label="Pod">
      <DetailRow
        label="Pod"
        icon={<ServerIcon aria-hidden className="size-3.5" />}
        actions={<PodStatusChip status={RUNNING_POD} onResize={simulateResize} settingsHref="#" />}
      />
    </section>
  )
}
