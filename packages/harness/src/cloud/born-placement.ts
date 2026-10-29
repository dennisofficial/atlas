import {
  EHarnessPlacement,
  ESettingId,
  EToolEnvironment,
  textValueOf,
  type SecretsPort,
  type SessionPlacement,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'
import type { VercelCredentialStore } from './vercel-credential-store'

/** Sandboxes can be provisioned: signed in, the Cloud userVercel resource holds the triple; signed out, the operator's local one. */
export async function cloudProvisioningConfigured(args: {
  settings: SettingsService
  secrets: SecretsPort
  vercel?: VercelCredentialStore | undefined
}): Promise<boolean> {
  if (args.vercel?.signedIn() === true) {
    await args.vercel.refresh().catch(() => undefined)
    const held = args.vercel.snapshot()
    return held.configured && held.teamId.length > 0 && held.projectId.length > 0
  }
  const token = args.secrets.read(ESettingId.VercelToken)
  if (token === undefined || token.trim().length === 0) return false
  const resolution = args.settings.snapshot().resolution
  if (textValueOf({ resolution, id: ESettingId.VercelTeamId }).length === 0) return false
  return textValueOf({ resolution, id: ESettingId.VercelProjectId }).length > 0
}

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
