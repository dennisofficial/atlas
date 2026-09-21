import {
  EConsultation,
  JEV_MODEL,
  jevAnswersSchema,
  jevRiskQuestions,
  JudgePort,
  verdictFromRisk,
  type Brief,
  type Consultation,
} from '@dltech/atlas-core'

export const JEV_TIMEOUT_MS = 2000

export type JevConfig = { baseUrl: string; token: string | undefined }

export type JevFetcher = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type JevJudgeDeps = {
  config: JevConfig
  fetcher?: JevFetcher | undefined
  timeoutMs?: number | undefined
  now?: (() => number) | undefined
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

export class JevJudge extends JudgePort {
  private readonly config: JevConfig
  private readonly fetcher: JevFetcher
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(deps: JevJudgeDeps) {
    super()
    this.config = deps.config
    this.fetcher = deps.fetcher ?? fetch
    this.timeoutMs = deps.timeoutMs ?? JEV_TIMEOUT_MS
    this.now = deps.now ?? (() => Date.now())
  }

  async consult({ brief, signal }: { brief: Brief; signal: AbortSignal }): Promise<Consultation> {
    const started = this.now()

    try {
      const response = await this.fetcher(this.config.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.token === undefined
            ? {}
            : { authorization: `Bearer ${this.config.token}` }),
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: brief.prompt,
          questions: jevRiskQuestions(),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      })

      if (!response.ok) {
        return {
          kind: EConsultation.Unreachable,
          fault: `the decision model answered ${response.status}`,
        }
      }

      const parsed = jevAnswersSchema.safeParse(await response.json())
      if (!parsed.success) {
        return {
          kind: EConsultation.Unreachable,
          fault: 'the decision model answered in a shape that was not readable',
        }
      }

      return {
        kind: EConsultation.Judged,
        verdict: verdictFromRisk({
          probability: parsed.data.answers.danger.noul,
          targets: brief.targets,
        }),
        elapsedMs: this.now() - started,
      }
    } catch (fault) {
      return { kind: EConsultation.Unreachable, fault: messageOf(fault) }
    }
  }
}
