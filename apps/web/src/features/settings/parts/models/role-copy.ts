export { roleTipOf, roleTitleOf, sentenceSubjectOf } from '@dltech/atlas-client/settings'

const SIGN_IN_NAMES: Readonly<Record<string, string>> = { Anthropic: 'Claude', OpenAI: 'Codex' }

export const signInNameOf = (provider: string): string => SIGN_IN_NAMES[provider] ?? provider
