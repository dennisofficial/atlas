import { ESettingId, textValueOf, type SecretsPort } from '@dltech/atlas-core'

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
