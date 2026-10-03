import { EFinishReason } from '../stream/chunk'
import { EAssistantPlaceholder, type AssistantPart, type EventDraft } from './body'
import type { Event } from './envelope'

export const EMPTY_STEP_NOTICE_STEPS = 2

export const EMPTY_STEP_NUDGES_PER_TURN = 1

export const EMPTY_STEP_RAW_RETRIES = 1

export const EMPTY_STEP_STREAK_LIMIT = 3

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

/**
 * Only a clean stop is worth silently re-requesting: a refusal (content-filter), a length cut, or
 * a provider error is a decided answer to the payload, not a dropped completion, and replaying the
 * identical request would just re-buy the same outcome. Observed against inference.net kimi-k3:
 * bursts of zero-token completions on a ~250k-token prompt that an unchanged replay answers once
 * the burst passes (2026-10-02 investigation).
 */
export function retriableEmptyStep(args: {
  parts: readonly AssistantPart[]
  toolCalls: readonly unknown[]
  finishReason: EFinishReason
}): boolean {
  if (args.finishReason !== EFinishReason.Stop) return false
  return silentStep(args)
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

export const NO_CONTENT_TEXT = '<no content>'

/**
 * The durable marker a turn ends on when the full retry chain (silent raw retry, then nudge) still
 * produced nothing: a completed turn whose only assistant output is this text. The turn closes
 * normally — ledger, cost accounting, roster and sub-thread endings all read it as a completed
 * run — and the placeholder flag lets renderers and the streak guard tell it apart from real
 * replies without pattern-matching the text.
 */
export function noContentDraft(): EventDraft {
  return {
    type: 'assistant-said',
    parts: [{ type: 'text', text: NO_CONTENT_TEXT }],
    placeholder: EAssistantPlaceholder.NoContent,
  }
}

/**
 * Consecutive turns that ended on the no-content placeholder: counting stops at the last real
 * assistant reply, since one answered turn proves the chain healed. Everything between the
 * endings (operator messages, tool rows, nudges) does not break the streak — only real model
 * speech does.
 */
export function noContentStreak(events: readonly Event[]): number {
  let streak = 0
  for (const event of [...events].reverse()) {
    if (event.type !== 'assistant-said') continue
    if (event.placeholder !== EAssistantPlaceholder.NoContent) return streak
    streak += 1
  }
  return streak
}

export function emptyTurnBlocked(events: readonly Event[]): boolean {
  return noContentStreak(events) >= EMPTY_STEP_STREAK_LIMIT
}

export function emptyTurnRefusal(): string {
  return [
    `Atlas refused to open this turn: the model ended the last ${EMPTY_STEP_STREAK_LIMIT} turns with <no content> — the provider keeps dropping its replies, so another identical turn was refused before it opened. No model request was sent.`,
    'Send again to acknowledge and force one more turn; if it comes back with <no content> again, switch the thread\u2019s model or compact its context to break the pattern.',
  ].join(' ')
}
