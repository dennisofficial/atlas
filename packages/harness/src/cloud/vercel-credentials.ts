import { ESettingId, ESettingsLayer, textValueOf, type SecretsPort } from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'

import type { VercelCredentials } from './vercel-driver'

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
   * The serve version a released Atlas pins — the same number the image tag carries, so the
   * sandbox's serve is this build's own by construction. Undefined for dev and source builds,
   * which trust whatever the image baked.
   */
  serveVersion?: string | undefined
}

/**
 * The image a cloud sandbox boots. An operator-set image always wins verbatim and pins nothing;
 * an unset one pins a release build to its own tag, so the serve baked into that image is the
 * TUI's own by construction.
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
  return { image: `atlas-sandbox:${args.release.version}`, serveVersion: args.release.version }
}
