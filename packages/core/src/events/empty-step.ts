import type { AssistantPart, EventDraft } from './body'

export const EMPTY_STEP_NOTICE_STEPS = 2

export const EMPTY_STEP_NUDGES_PER_TURN = 1

/**
 * A step that gave the thread nothing to act on: no tool calls and no readable text. Reasoning
 * alone does not count as a reply — the operator never sees it as an answer and awaitsReply
 * stays the thread's truth either way, so a reasoning-only step is as silent as an empty one.
 * Providers drop replies like this (kimi-k3 returns zero tokens on some image-heavy prompts)
 * and an undetected silent step ends the turn looking completed.
 */
export function silentStep(args: {
  parts: readonly AssistantPart[]
  toolCalls: readonly unknown[]
}): boolean {
  if (args.toolCalls.length > 0) return false
  return !args.parts.some((part) => part.type === 'text' && part.text.trim().length > 0)
}

export function emptyStepNotice(): string {
  return [
    'Your previous step came back from the model empty: no text and no tool calls reached Atlas, so the operator saw nothing and the turn could not end. That is the provider dropping the reply, not a decision you made.',
    'Reply now: report what you have, or name what is missing. If the most recent tool result is what the reply choked on — too large, or unreadable — say so and take a different approach rather than repeating the same read.',
  ].join(' ')
}

export function emptyStepNudgeDraft(): EventDraft {
  return { type: 'nudge', text: emptyStepNotice(), lifetimeSteps: EMPTY_STEP_NOTICE_STEPS }
}
