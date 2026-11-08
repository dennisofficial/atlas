import { CORE_EVENT_TYPES, RECORD_ONLY_TYPES } from '@dltech/atlas-core'

export const defaultKnownEventTypes: ReadonlySet<string> = new Set([
  ...CORE_EVENT_TYPES,
  ...RECORD_ONLY_TYPES,
])
