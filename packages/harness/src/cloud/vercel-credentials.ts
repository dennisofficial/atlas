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
  /** Logical stamps a baked serve in the image may carry — empty unless the image is Atlas's own pinned build. */
  serveSources: readonly string[]
}

/**
 * The image a cloud sandbox boots. An operator-set image always wins verbatim and carries no
 * baked-serve trust; an unset one pins a release build to its own tag, so the serve baked into
 * that image is the TUI's own by construction and the boot skips the 109MB download.
 */
export function sandboxImageOf(args: {
  settings: SettingsService
  release?: { version: string; buildSha: string } | undefined
}): SandboxImageChoice {
  const resolution = args.settings.snapshot().resolution
  const held = resolution.settings.get(ESettingId.SandboxImage)
  const image = textValueOf({ resolution, id: ESettingId.SandboxImage })
  if (held?.layer !== ESettingsLayer.Default) return { image, serveSources: [] }
  if (args.release === undefined) return { image, serveSources: [] }
  return {
    image: `atlas-sandbox:${args.release.version}`,
    serveSources: [`source:${args.release.buildSha}`],
  }
}
