import { ESettingId, ESettingsLayer, textValueOf, type SecretsPort } from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'

import type { VercelCredentials } from '@dltech/atlas-wire'

const SETTINGS_POINTER = 'settings (ctrl+o) › cloud'

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

export type SandboxImageChoice = {
  image: string
  /**
   * The serve version a released Atlas pins — this build's own release version, independent of
   * the image, since serve is downloaded into the sandbox at boot. Undefined for dev and source
   * builds, which trust whatever serve the sandbox already runs.
   */
  serveVersion?: string | undefined
}

/**
 * The image a cloud sandbox boots. An operator-set image always wins verbatim and pins nothing;
 * an unset one boots the latest runtime image, and a release build's own version rides along as
 * the serve pin.
 */
export function sandboxImageOf(args: {
  settings: SettingsService
  release?: { version: string } | undefined
}): SandboxImageChoice {
  const resolution = args.settings.snapshot().resolution
  const held = resolution.settings.get(ESettingId.SandboxImage)
  const image = textValueOf({ resolution, id: ESettingId.SandboxImage })
  if (held?.layer !== ESettingsLayer.Default) return { image }
  if (args.release === undefined) return { image }
  return { image, serveVersion: args.release.version }
}
