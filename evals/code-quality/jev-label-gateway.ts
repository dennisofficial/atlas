import { z } from 'zod'

import { type JevLabelAnswer, type JevLabelMessages, parseLabelAnswer } from './jev-label-answer'

export const JEV_LABEL_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions'
export const JEV_LABEL_GATEWAY_KEY_ENV = 'AI_GATEWAY_API_KEY'
export const JEV_LABEL_TIMEOUT_MS = 600_000
export const JEV_LABEL_ATTEMPTS = 3
export const JEV_LABEL_RETRY_MS = 2_000

export type JevLabeller = (args: {
  model: string
  messages: JevLabelMessages
}) => Promise<JevLabelAnswer>

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
})

const messageOf = (fault: unknown): string =>
  fault instanceof Error ? fault.message : String(fault)

const pause = ({ ms }: { ms: number }): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export function createGatewayLabeller({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = JEV_LABEL_TIMEOUT_MS,
  attempts = JEV_LABEL_ATTEMPTS,
}: {
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  attempts?: number
}): JevLabeller {
  return async ({ model, messages }) => {
    let lastFault = 'the labeller call never ran'
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(JEV_LABEL_GATEWAY_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: messages.system },
              { role: 'user', content: messages.user },
            ],
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const text = await response.text()
        if (!response.ok) {
          lastFault = `${model} answered ${response.status}: ${text.slice(0, 300)}`
          continue
        }
        const completion = completionSchema.parse(JSON.parse(text) as unknown)
        return parseLabelAnswer({ text: completion.choices[0]?.message.content ?? '' })
      } catch (fault) {
        lastFault = `${model}: ${messageOf(fault)}`
      }
      if (attempt < attempts) await pause({ ms: JEV_LABEL_RETRY_MS * attempt })
    }
    throw new Error(`labeller ${model} failed: ${lastFault}`)
  }
}
