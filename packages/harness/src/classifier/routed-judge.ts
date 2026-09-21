import {
  ESettingId,
  JudgePort,
  textValueOf,
  type Brief,
  type Consultation,
  type SecretsPort,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'
import type { JevConfig } from './jev-client'

export const DECISIONS_SECRET_NAME: string = ESettingId.DecisionsToken

export function decisionsConfigFrom(args: {
  settings: SettingsService
  secrets: SecretsPort
}): () => JevConfig | undefined {
  const { settings, secrets } = args
  return () => {
    const baseUrl = textValueOf({
      resolution: settings.snapshot().resolution,
      id: ESettingId.DecisionsUrl,
    })
    if (baseUrl.length === 0) return undefined
    return { baseUrl, token: secrets.read(DECISIONS_SECRET_NAME) }
  }
}

export type RoutedJudgeDeps = {
  fallback: JudgePort
  jev: JudgePort
  enabled: () => boolean
}

export class RoutedJudge extends JudgePort {
  private readonly fallback: JudgePort
  private readonly jev: JudgePort
  private readonly enabled: () => boolean

  constructor(deps: RoutedJudgeDeps) {
    super()
    this.fallback = deps.fallback
    this.jev = deps.jev
    this.enabled = deps.enabled
  }

  async consult(args: { brief: Brief; signal: AbortSignal }): Promise<Consultation> {
    return this.enabled() ? this.jev.consult(args) : this.fallback.consult(args)
  }
}
