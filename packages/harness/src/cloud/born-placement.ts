import {
  EHarnessPlacement,
  EToolEnvironment,
  type SecretsPort,
  type SessionPlacement,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'

/**
 * The placement a brand-new thread is born with: always the host. The cloud is an explicit
 * per-thread choice made by the surface, never a default. A thread born on the host can still
 * switch its tool environment (host/docker) through `execution_location`; neither kind ever moves
 * afterwards.
 */
export function bornPlacementFor(_args: {
  settings: SettingsService
  secrets: SecretsPort
}): SessionPlacement {
  return { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host }
}
