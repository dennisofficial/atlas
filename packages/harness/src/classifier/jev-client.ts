import {
  jevAnswersSchema,
  JEV_MODEL,
  type DecisionOutcome,
  type DecisionPort,
  type DecisionQuestion,
} from '@dltech/atlas-core'

export const JEV_TIMEOUT_MS = 2000

export type JevConfig = { baseUrl: string; token: string | undefined }

export type JevFetcher = (
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export type JevDecisionClientDeps = {
  config: () => JevConfig | undefined
  fetcher?: JevFetcher | undefined
  timeoutMs?: number | undefined
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

export class JevDecisionClient implements DecisionPort {
  private readonly config: () => JevConfig | undefined
  private readonly fetcher: JevFetcher
  private readonly timeoutMs: number

  constructor(deps: JevDecisionClientDeps) {
    this.config = deps.config
    this.fetcher = deps.fetcher ?? fetch
    this.timeoutMs = deps.timeoutMs ?? JEV_TIMEOUT_MS
  }

  async decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
  }): Promise<DecisionOutcome> {
    const config = this.config()
    if (config === undefined) return { ok: false, fault: 'decisions.url is not set' }

    try {
      const response = await this.fetcher(config.baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.token === undefined ? {} : { authorization: `Bearer ${config.token}` }),
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: args.state,
          questions: args.questions,
        }),
        signal: AbortSignal.any([args.signal, AbortSignal.timeout(this.timeoutMs)]),
      })

      if (!response.ok) {
        return { ok: false, fault: `the decision model answered ${response.status}` }
      }

      const parsed = jevAnswersSchema.safeParse(await response.json())
      if (!parsed.success) {
        return { ok: false, fault: 'the decision model answered in a shape that was not readable' }
      }

      return { ok: true, answers: parsed.data.answers }
    } catch (fault) {
      return { ok: false, fault: messageOf(fault) }
    }
  }
}
