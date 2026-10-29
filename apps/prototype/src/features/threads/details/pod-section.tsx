import { PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'

import { RUNNING_POD, simulateResize } from '../pod-status'
import { DetailsSection } from './section'

export function PodSection() {
  return (
    <DetailsSection title="Pod">
      <div className="flex">
        <PodStatusChip status={RUNNING_POD} onResize={simulateResize} settingsHref="#" />
      </div>
    </DetailsSection>
  )
}
