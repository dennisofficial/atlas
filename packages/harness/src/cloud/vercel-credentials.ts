import { ESettingId, textValueOf, type SecretsPort } from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'

import type { VercelCredentials } from './vercel-driver'

const SETTINGS_POINTER = 'settings (ctrl+o) › general › cloud sandboxes'

export class VercelNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`cloud sandboxes run on your own Vercel account — ${detail} under ${SETTINGS_POINTER}, then try again`)
    this.name = 'VercelNotConfiguredError'
  }
}

/**
 * The SDK takes a personal access token only as the full triple — token, team, project — and the
 * operator's team and project are settings rather than secrets, since they identify rather than
 * authenticate.
 */
export function requireVercelCredentials(args: {
  settings: SettingsService
  secrets: SecretsPort
}): VercelCredentials {
  const token = args.secrets.read(ESettingId.VercelToken)
  if (token === undefined || token.trim().length === 0) {
    throw new VercelNotConfiguredError('add your Vercel token')
  }

  const resolution = args.settings.snapshot().resolution
  const teamId = textValueOf({ resolution, id: ESettingId.VercelTeamId })
  const projectId = textValueOf({ resolution, id: ESettingId.VercelProjectId })
  if (teamId.length === 0) {
    throw new VercelNotConfiguredError('add your Vercel team ID')
  }
  if (projectId.length === 0) {
    throw new VercelNotConfiguredError('add your Vercel project ID')
  }

  return { token, teamId, projectId }
}

export function sandboxImageOf(args: { settings: SettingsService }): string {
  return textValueOf({
    resolution: args.settings.snapshot().resolution,
    id: ESettingId.SandboxImage,
  })
}
