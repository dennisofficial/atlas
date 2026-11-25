import {
  ClassifierPort,
  EClassifierFault,
  type ClassifierCall,
  type ClassifierOutcome,
  type ClassifierUsage,
} from '@dltech/atlas-core'

import { decisionsAnswersOf, decisionsRequestOf } from './translate'

export const OPENAI_DECISIONS_TIMEOUT_MS = 10_000

export type OpenAiClassifierArgs = {
  endpoint: string
  model: string
  apiKey: string
  fetch?: typeof fetch | undefined
  timeoutMs?: number | undefined
}

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

const inputTokensOf = (body: unknown): number | null => {
  if (typeof body !== 'object' || body === null) return null
  const usage = (body as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return null
  const tokens = (usage as { prompt_tokens?: unknown }).prompt_tokens
  return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : null
}

const usageOf = (body: unknown): ClassifierUsage | undefined => {
  const inputTokens = inputTokensOf(body)
  return inputTokens === null ? undefined : { inputTokens }
}

export class OpenAiClassifier extends ClassifierPort {
  private readonly send: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly args: OpenAiClassifierArgs) {
    super()
    this.send = args.fetch ?? fetch
    this.timeoutMs = args.timeoutMs ?? OPENAI_DECISIONS_TIMEOUT_MS
  }

  async classify(args: ClassifierCall): Promise<ClassifierOutcome> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const abort = (): void => controller.abort()
    if (args.signal.aborted) abort()
    args.signal.addEventListener('abort', abort)

    try {
      const response = await this.send(this.args.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.args.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.args.model,
          input: args.state,
          questions: decisionsRequestOf({ questions: args.questions }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = (await response.text()).slice(0, 200)
        return {
          ok: false,
          fault: EClassifierFault.Rejected,
          detail: `${response.status}: ${body}`,
        }
      }
      let body: unknown
      try {
        body = await response.json()
      } catch (fault) {
        return controller.signal.aborted
          ? { ok: false, fault: EClassifierFault.Aborted, detail: messageOf(fault) }
          : {
              ok: false,
              fault: EClassifierFault.Malformed,
              detail: 'the classifier answered with a body that was not readable',
            }
      }
      const translated = decisionsAnswersOf({ questions: args.questions, body })
      if (!translated.ok) {
        return { ok: false, fault: translated.fault, detail: translated.detail }
      }
      const usage = usageOf(body)
      return {
        ok: true,
        answers: translated.answers,
        model: this.args.model,
        ...(usage === undefined ? {} : { usage }),
      }
    } catch (fault) {
      if (controller.signal.aborted) {
        return { ok: false, fault: EClassifierFault.Aborted, detail: messageOf(fault) }
      }
      return { ok: false, fault: EClassifierFault.Rejected, detail: messageOf(fault) }
    } finally {
      clearTimeout(timer)
      args.signal.removeEventListener('abort', abort)
    }
  }
}
