import type { QualityPolicy, QualityPolicyDescriptor } from '@dltech/atlas-core'

import { singleResponsibilityPolicy } from '../policies'

const describe = ({
  id,
  version,
  title,
  description,
  settingKey,
  defaultEnabled,
}: QualityPolicy): QualityPolicyDescriptor => ({
  id,
  version,
  title,
  description,
  settingKey,
  defaultEnabled,
})

export const QUALITY_POLICY_DESCRIPTORS: readonly QualityPolicyDescriptor[] = [
  describe(singleResponsibilityPolicy),
]
