import {
  openAiDecisionsResponseSchema,
  translateAnswers,
  translateQuestions,
  type DecisionOutcome,
  type DecisionPort,
  type DecisionQuestion,
} from '@dltech/atlas-core'

export const OPENAI_DECISIONS_TIMEOUT_MS = 10_000

export type OpenAiDecisionsConfig = { url: string; token: string | undefined; model: string }

export type OpenAiDecisionClientDeps = {
  config: () => OpenAiDecisionsConfig | undefined
  fetch?: typeof fetch | undefined
  timeoutMs?: number | undefined
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

// POST /v1/decisions: https://platform.openai.com/docs/api-reference/decisions
export class OpenAiDecisionClient implements DecisionPort {
  private readonly config: () => OpenAiDecisionsConfig | undefined
  private readonly send: typeof fetch
  private readonly timeoutMs: number

  constructor(deps: OpenAiDecisionClientDeps) {
    this.config = deps.config
    this.send = deps.fetch ?? fetch
    this.timeoutMs = deps.timeoutMs ?? OPENAI_DECISIONS_TIMEOUT_MS
  }

  async decide(args: {
    state: string
    questions: Record<string, DecisionQuestion>
    signal: AbortSignal
    model?: string | undefined
  }): Promise<DecisionOutcome> {
    const config = this.config()
    if (config === undefined) return { ok: false, fault: 'decisions.url is not set' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const abort = (): void => controller.abort()
    if (args.signal.aborted) abort()
    args.signal.addEventListener('abort', abort)

    try {
      const response = await this.send(config.url, {
        method: 'POST',
        headers: {
          ...(config.token === undefined ? {} : { Authorization: `Bearer ${config.token}` }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: args.state,
          questions: translateQuestions({ questions: args.questions }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = (await response.text()).slice(0, 300)
        return { ok: false, fault: `openai decisions answered ${response.status}: ${body}` }
      }
      const parsed = openAiDecisionsResponseSchema.safeParse(await response.json())
      if (!parsed.success) {
        return { ok: false, fault: 'openai decisions answered in a shape that was not readable' }
      }
      return {
        ok: true,
        answers: translateAnswers({ answers: parsed.data.answers }),
        model: parsed.data.model ?? config.model,
      }
    } catch (fault) {
      return { ok: false, fault: messageOf(fault) }
    } finally {
      clearTimeout(timer)
      args.signal.removeEventListener('abort', abort)
    }
  }
}
