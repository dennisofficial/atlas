import {
  createQualityRegistry,
  singleResponsibilityPolicy,
  type QualityPolicy,
} from '@dltech/atlas-core'

export const QUALITY_POLICIES: readonly QualityPolicy[] = [singleResponsibilityPolicy]

export const qualityRegistry = createQualityRegistry({ policies: QUALITY_POLICIES })
