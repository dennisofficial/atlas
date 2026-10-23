import { EEffort } from '@dltech/atlas-ui/ai/model-selector'

import { EProviderId } from './settings-agent'

export enum EAgentRole {
  Main = 'main',
  Subagents = 'subagents',
  Quick = 'quick',
  Compaction = 'compaction',
}

export enum EConnectionStatus {
  Active = 'active',
  Expired = 'expired',
}

export const PROVIDER_LABELS: Record<EProviderId, string> = {
  [EProviderId.Anthropic]: 'Anthropic',
  [EProviderId.OpenAI]: 'OpenAI',
  [EProviderId.OpenRouter]: 'OpenRouter',
  [EProviderId.Inference]: 'Inference.net',
  [EProviderId.Gateway]: 'AI Gateway',
}

export const AUTO_MODEL = 'auto'

export type RoleSetting = { model: string; effort: EEffort }
export type ModelsConfig = Record<EAgentRole, RoleSetting>

const OPUS = 'anthropic/claude-opus-4-7'
const SONNET = 'anthropic/claude-sonnet-4-6'
const HAIKU = 'anthropic/claude-haiku-4-5'
const GPT_5 = 'openai/gpt-5'
const GPT_5_MINI = 'openai/gpt-5-mini'
const GEMINI = 'google/gemini-2-5-pro'
const LLAMA = 'meta-llama/llama-4-maverick'
const LLAMA_REF = 'openrouter/meta-llama/llama-4-maverick'

export const ROLE_ORDER: EAgentRole[] = [
  EAgentRole.Main,
  EAgentRole.Subagents,
  EAgentRole.Quick,
  EAgentRole.Compaction,
]

export const ROLE_META: Record<
  EAgentRole,
  { title: string; description: string; autoOrder: string[]; follows?: EAgentRole }
> = {
  [EAgentRole.Main]: {
    title: 'Main agent',
    description: 'Plans, edits code and replies in the thread.',
    autoOrder: [OPUS, SONNET, GPT_5, GEMINI],
  },
  [EAgentRole.Subagents]: {
    title: 'Sub-agents',
    description: 'Parallel workers for search, review and builds.',
    autoOrder: [SONNET, GPT_5, OPUS],
    follows: EAgentRole.Main,
  },
  [EAgentRole.Quick]: {
    title: 'Quick calls',
    description: 'Titles, summaries and nudges.',
    autoOrder: [HAIKU, GPT_5_MINI, LLAMA],
  },
  [EAgentRole.Compaction]: {
    title: 'Compaction',
    description: 'Condenses long threads to free up context.',
    autoOrder: [SONNET, GPT_5, HAIKU],
    follows: EAgentRole.Main,
  },
}

export const DEFAULT_MODELS_CONFIG: ModelsConfig = {
  [EAgentRole.Main]: { model: AUTO_MODEL, effort: EEffort.Medium },
  [EAgentRole.Subagents]: { model: AUTO_MODEL, effort: EEffort.Medium },
  [EAgentRole.Quick]: { model: AUTO_MODEL, effort: EEffort.Low },
  [EAgentRole.Compaction]: { model: AUTO_MODEL, effort: EEffort.Low },
}

export const EDITED_MODELS_CONFIG: ModelsConfig = {
  [EAgentRole.Main]: { model: AUTO_MODEL, effort: EEffort.High },
  [EAgentRole.Subagents]: { model: GPT_5, effort: EEffort.Medium },
  [EAgentRole.Quick]: { model: LLAMA_REF, effort: EEffort.Low },
  [EAgentRole.Compaction]: { model: SONNET, effort: EEffort.Low },
}

export const RECONNECT_MODELS_CONFIG: ModelsConfig = {
  ...DEFAULT_MODELS_CONFIG,
  [EAgentRole.Main]: { model: OPUS, effort: EEffort.High },
}

export const DEFAULT_PINNED = [OPUS, SONNET, GPT_5]

export type Connection = { label: string; short: string }
export type ProviderAccess = {
  plan: (Connection & { status: EConnectionStatus }) | null
  key: Connection | null
}
export type ProviderAccessMap = Partial<Record<EProviderId, ProviderAccess>>

const CLAUDE_MAX: ProviderAccess = {
  plan: { label: 'Claude Max', short: 'Max', status: EConnectionStatus.Active },
  key: { label: 'Anthropic API key', short: 'API key' },
}

const CHATGPT_PLUS: ProviderAccess = {
  plan: { label: 'ChatGPT Plus', short: 'Plus', status: EConnectionStatus.Active },
  key: null,
}

const OPENROUTER_KEY: ProviderAccess = {
  plan: null,
  key: { label: 'OpenRouter', short: 'OpenRouter' },
}

const INFERENCE_KEY: ProviderAccess = {
  plan: null,
  key: { label: 'Inference.net', short: 'Inference.net' },
}

const GATEWAY_KEY: ProviderAccess = {
  plan: null,
  key: { label: 'AI Gateway', short: 'AI Gateway' },
}

export const ACCESS_ALL: ProviderAccessMap = {
  [EProviderId.Anthropic]: CLAUDE_MAX,
  [EProviderId.OpenAI]: CHATGPT_PLUS,
  [EProviderId.OpenRouter]: OPENROUTER_KEY,
  [EProviderId.Inference]: INFERENCE_KEY,
  [EProviderId.Gateway]: GATEWAY_KEY,
}

export const ACCESS_CLAUDE_ONLY: ProviderAccessMap = {
  [EProviderId.Anthropic]: CLAUDE_MAX,
}

export const ACCESS_OPENROUTER_ONLY: ProviderAccessMap = {
  [EProviderId.OpenRouter]: OPENROUTER_KEY,
}

export const ACCESS_CLAUDE_EXPIRED: ProviderAccessMap = {
  ...ACCESS_ALL,
  [EProviderId.Anthropic]: {
    plan: { label: 'Claude Max', short: 'Max', status: EConnectionStatus.Expired },
    key: null,
  },
}

export const ACCESS_NONE: ProviderAccessMap = {}
