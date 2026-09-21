import {
  EConsultation,
  JEV_RISK_KEY,
  jevRiskQuestions,
  JudgePort,
  verdictFromRisk,
  type Brief,
  type Consultation,
  type DecisionPort,
} from '@dltech/atlas-core'

export type JevJudgeDeps = {
  decisions: DecisionPort
  now?: (() => number) | undefined
}

export class JevJudge extends JudgePort {
  private readonly decisions: DecisionPort
  private readonly now: () => number

  constructor(deps: JevJudgeDeps) {
    super()
    this.decisions = deps.decisions
    this.now = deps.now ?? (() => Date.now())
  }

  async consult({ brief, signal }: { brief: Brief; signal: AbortSignal }): Promise<Consultation> {
    const started = this.now()

    const outcome = await this.decisions.decide({
      state: brief.prompt,
      questions: jevRiskQuestions(),
      signal,
    })

    if (!outcome.ok) return { kind: EConsultation.Unreachable, fault: outcome.fault }

    const noul = outcome.answers[JEV_RISK_KEY]?.noul
    if (noul === undefined) {
      return {
        kind: EConsultation.Unreachable,
        fault: 'the decision model answered without a risk probability',
      }
    }

    return {
      kind: EConsultation.Judged,
      verdict: verdictFromRisk({ probability: noul, targets: brief.targets }),
      elapsedMs: this.now() - started,
    }
  }
}
