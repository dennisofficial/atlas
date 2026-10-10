import {
  EHarnessPlacement,
  ESettingId,
  EToolEnvironment,
  textValueOf,
  type SecretsPort,
  type SessionPlacement,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'

/** Sandboxes can be provisioned: the operator's own Vercel triple is all a create rides on. */
export function cloudProvisioningConfigured(args: {
  settings: SettingsService
  secrets: SecretsPort
}): boolean {
  const token = args.secrets.read(ESettingId.VercelToken)
  if (token === undefined || token.trim().length === 0) return false
  const resolution = args.settings.snapshot().resolution
  if (textValueOf({ resolution, id: ESettingId.VercelTeamId }).length === 0) return false
  return textValueOf({ resolution, id: ESettingId.VercelProjectId }).length > 0
}

/**
 * The placement a brand-new thread is born with: the cloud when this machine can provision a
 * sandbox for it, the host otherwise. A thread born on the host can still switch its tool
 * environment (host/docker) through `execution_location`; neither kind ever moves afterwards.
 */
export function bornPlacementFor(args: {
  settings: SettingsService
  secrets: SecretsPort
}): SessionPlacement {
  if (!cloudProvisioningConfigured(args)) {
    return { harness: EHarnessPlacement.Host, tools: EToolEnvironment.Host }
  }
  return { harness: EHarnessPlacement.Cloud }
}
