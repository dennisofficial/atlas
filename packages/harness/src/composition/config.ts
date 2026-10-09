import type { ModelRef, ThreadId } from '@dltech/atlas-core'

export const DEFAULT_MODEL_REF: ModelRef = {
  providerId: 'anthropic',
  modelId: 'claude-haiku-4-5',
}

/** The eval harness replays shipped tl;dr behavior, so it pins the model the feature shipped on. */
export const TLDR_MODEL_ID = 'claude-haiku-4-5-20251001'

/** What a launch decides for itself and nothing that outlives it; anything durable is a setting. */
export type HarnessLaunch = {
  /** The project directory. Undefined is a session with no workspace — an orchestrator agent owning a flow rather than a checkout. */
  cwd: string | undefined
  command: string
  /** The model the launch pins, with the effort it was running on when a resumed session carried one. A bare ref string is a model with no opinion on effort. */
  model: { ref: string; effort?: string | undefined } | undefined
  executionLocation: string | undefined
  /**
   * The thread whose restored log seeds plugin projections at compose. A launch without a surface
   * (serve) names its thread so projections fold before the first turn; a launch with a surface
   * leaves it unset and its surface publishes the live log instead.
   */
  threadId?: ThreadId | undefined
}
