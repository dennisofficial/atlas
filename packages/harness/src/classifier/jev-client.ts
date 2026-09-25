import { TypeSafeClient, type Questions } from '@typesafe-ai/sdk'
import {
  jevAnswersSchema,
  JEV_MODEL,
  type DecisionOutcome,
  type DecisionPort,
  type DecisionQuestion,
} from '@dltech/atlas-core'

export const JEV_TIMEOUT_MS = 2000

export type JevConfig = { baseUrl: string; token: string | undefined }

export type JevSystemOne = (
  request: { state: string; questions: Questions; model: string },
  options?: { signal?: AbortSignal | undefined },
) => PromiseLike<unknown>

export type JevDecisionClientDeps = {
  config: () => JevConfig | undefined
  systemOne?: JevSystemOne | undefined
  timeoutMs?: number | undefined
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

// The SDK appends /v1/systemone to baseURL, so a decisions.url that already carries the route
// (as the hosted-Jev URL in the setting's description does) would otherwise 404 every call on
// a doubled path.
export const jevBaseUrl = (url: string): string =>
  url.replace(/\/+$/, '').replace(/\/v1\/systemone$/i, '')

// The endpoint stays a config seam: decisions.url points at hosted Jev, a gateway route, or a
// self-hosted server speaking the same shape (Laya answers /v1/systemone unauthenticated). A
// Laya tokenless config gets a placeholder key — the server ignores it, the SDK requires the
// field.
export class JevDecisionClient implements DecisionPort {
  private readonly config: () => JevConfig | undefined
  private readonly systemOneFor: (config: JevConfig) => JevSystemOne
  private readonly timeoutMs: number

  constructor(deps: JevDecisionClientDeps) {
    this.config = deps.config
    this.timeoutMs = deps.timeoutMs ?? JEV_TIMEOUT_MS
    this.systemOneFor =
      deps.systemOne === undefined
        ? (config) => {
            const client = new TypeSafeClient({
              baseURL: jevBaseUrl(config.baseUrl),
              apiKey: config.token ?? 'unauthenticated',
              timeout: this.timeoutMs,
              retry: { maxRetries: 0 },
            })
            return (request, options) =>
              client.systemOne(request, { ...(options?.signal === undefined ? {} : { signal: options.signal }) })
          }
        : () => deps.systemOne as JevSystemOne
  }

  async decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
  }): Promise<DecisionOutcome> {
    const config = this.config()
    if (config === undefined) return { ok: false, fault: 'decisions.url is not set' }

    try {
      const result = await this.systemOneFor(config)(
        { state: args.state, questions: args.questions as Questions, model: JEV_MODEL },
        { signal: args.signal },
      )
      const parsed = jevAnswersSchema.safeParse(result)
      if (!parsed.success) {
        return { ok: false, fault: 'the decision model answered in a shape that was not readable' }
      }
      return { ok: true, answers: parsed.data.answers }
    } catch (fault) {
      return { ok: false, fault: messageOf(fault) }
    }
  }
}
