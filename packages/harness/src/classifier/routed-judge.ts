import { JudgePort, type Brief, type Consultation } from '@dltech/atlas-core'

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
