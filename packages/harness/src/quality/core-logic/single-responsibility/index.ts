import type { QualityPolicy } from '@dltech/atlas-core'

import { guidance } from './guidance'
import {
  SRP_DESCRIPTION,
  SRP_POLICY_ID,
  SRP_POLICY_VERSION,
  SRP_SETTING_KEY,
  SRP_TITLE,
} from './identity'
import { interpret } from './interpret'
import { questions } from './questions'
import { selectScopes } from './select'
import { SRP_DEFINITION, SRP_EXCEPTIONS } from './text'

export {
  CONCERN_INTRODUCE_THRESHOLD,
  CONCERN_RESOLVE_THRESHOLD,
  FOCUS_CONFIDENCE_THRESHOLD,
  IMPACT_CONFIDENCE_THRESHOLD,
} from './interpret'
export { FOCUS_NONE, FOCUS_UNCERTAIN } from './keys'
export { SRP_POLICY_ID, SRP_POLICY_VERSION, SRP_TITLE } from './identity'

export const singleResponsibilityPolicy: QualityPolicy = {
  id: SRP_POLICY_ID,
  version: SRP_POLICY_VERSION,
  title: SRP_TITLE,
  description: SRP_DESCRIPTION,
  settingKey: SRP_SETTING_KEY,
  defaultEnabled: true,
  definition: SRP_DEFINITION,
  exceptions: SRP_EXCEPTIONS,
  selectScopes,
  questions,
  interpret,
  guidance,
}
