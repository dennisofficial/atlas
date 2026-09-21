import {
  ESettingId,
  JudgePort,
  textValueOf,
  type Brief,
  type Consultation,
  type SecretsPort,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'
import { JevJudge, type JevConfig } from './jev-judge'

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
  config: () => JevConfig | undefined
  makeJev?: ((config: JevConfig) => JudgePort) | undefined
}

export class RoutedJudge extends JudgePort {
  private readonly fallback: JudgePort
  private readonly config: () => JevConfig | undefined
  private readonly makeJev: (config: JevConfig) => JudgePort
  private held: { key: string; judge: JudgePort } | undefined

  constructor(deps: RoutedJudgeDeps) {
    super()
    this.fallback = deps.fallback
    this.config = deps.config
    this.makeJev = deps.makeJev ?? ((config) => new JevJudge({ config }))
  }

  async consult(args: { brief: Brief; signal: AbortSignal }): Promise<Consultation> {
    const config = this.config()
    if (config === undefined) return this.fallback.consult(args)

    const key = `${config.baseUrl} ${config.token ?? ''}`
    if (this.held?.key !== key) this.held = { key, judge: this.makeJev(config) }
    return this.held.judge.consult(args)
  }
}
