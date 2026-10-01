import type { Assembled } from '../assembled'
import type { RuleContext } from '../rule'

export function endsOnCompletedAssistant({ input, ctx }: { input: Assembled; ctx: RuleContext }): boolean {
  const last = input.messages.at(-1)
  return last?.message.role === 'assistant' && last.origin.eventId === ctx.events.at(-1)?.id
}
