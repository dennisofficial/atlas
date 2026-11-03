import type { ModelCard } from '@dltech/atlas-core'

// Anthropic's /v1/models lists no speed capability, so the fast-mode models are kept by hand from
// https://platform.claude.com/docs/en/build-with-claude/fast-mode. Opus 4.8 is left out: its fast
// mode is removed on 2026-11-30.
const ANTHROPIC_FAST_MODEL_IDS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-opus-5'])

export const offersFastMode = (ref: ModelCard['ref']): boolean =>
  ref.providerId === 'anthropic' && ANTHROPIC_FAST_MODEL_IDS.has(ref.modelId)
