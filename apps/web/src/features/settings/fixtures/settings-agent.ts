import { EBrand } from '@dltech/atlas-ui/components/brand-mark'
import { EEffortLevel } from '@dltech/atlas-wire/web'

export const INSTRUCTIONS_CHAR_LIMIT = 8000

export enum EAgentRole {
  Main = 'main',
  Subagents = 'subagents',
  Quick = 'quick',
  Compaction = 'compaction',
}

export { EEffortLevel as EEffort }

export enum EPreset {
  Fast = 'fast',
  Balanced = 'balanced',
  Thorough = 'thorough',
}

export const EFFORT_STEPS: {
  effort: EEffortLevel
  label: string
  short: string
}[] = [
  { effort: EEffortLevel.Off, label: 'Off', short: 'Off' },
  { effort: EEffortLevel.Minimal, label: 'Minimal', short: 'Min' },
  { effort: EEffortLevel.Low, label: 'Low', short: 'Low' },
  { effort: EEffortLevel.Medium, label: 'Medium', short: 'Med' },
  { effort: EEffortLevel.High, label: 'High', short: 'High' },
  { effort: EEffortLevel.XHigh, label: 'XHigh', short: 'XHigh' },
  { effort: EEffortLevel.Max, label: 'Max', short: 'Max' },
]

export const AUTO_MODEL = 'auto'

export type RoleSetting = { model: string; effort?: EEffortLevel }
export type ModelsConfig = Record<EAgentRole, RoleSetting>

export const ROLE_META: Record<
  EAgentRole,
  {
    title: string
    description: string
    autoLabel: string
    modelHint: string
    hasEffort: boolean
  }
> = {
  [EAgentRole.Main]: {
    title: 'Main agent',
    description: 'Plans the work, edits code, and talks to you in the thread.',
    autoLabel: 'Auto · Claude Opus',
    modelHint: 'Auto picks the best available model for your connected providers.',
    hasEffort: true,
  },
  [EAgentRole.Subagents]: {
    title: 'Subagents',
    description: 'Parallel workers the main agent spawns for search, review, and builds.',
    autoLabel: 'Follow main agent',
    modelHint: 'New subagents run on this model. Left on follow, they use the main agent’s model.',
    hasEffort: false,
  },
  [EAgentRole.Quick]: {
    title: 'Quick calls',
    description: 'Background calls: tl;dr footers, session titles and the nudge judge.',
    autoLabel: 'Follow default',
    modelHint: 'These calls always run at low effort. Left on follow, they use the default model.',
    hasEffort: false,
  },
  [EAgentRole.Compaction]: {
    title: 'Compaction',
    description: 'Summarises older turns when the context window fills.',
    autoLabel: 'Follow default',
    modelHint:
      'The summary is all the next turn sees of what it replaces. Left on follow, it uses the default model.',
    hasEffort: false,
  },
}

export const ROLE_ORDER: EAgentRole[] = [
  EAgentRole.Main,
  EAgentRole.Subagents,
  EAgentRole.Quick,
  EAgentRole.Compaction,
]

export const PRESET_LABELS: Record<EPreset, string> = {
  [EPreset.Fast]: 'Fast',
  [EPreset.Balanced]: 'Balanced',
  [EPreset.Thorough]: 'Thorough',
}

export const PRESETS: Record<EPreset, ModelsConfig> = {
  [EPreset.Fast]: {
    [EAgentRole.Main]: {
      model: 'anthropic/claude-sonnet-5',
      effort: EEffortLevel.Low,
    },
    [EAgentRole.Subagents]: { model: 'openai/gpt-5-mini' },
    [EAgentRole.Quick]: { model: 'openai/gpt-5-mini' },
    [EAgentRole.Compaction]: { model: AUTO_MODEL },
  },
  [EPreset.Balanced]: {
    [EAgentRole.Main]: { model: AUTO_MODEL, effort: EEffortLevel.Medium },
    [EAgentRole.Subagents]: { model: AUTO_MODEL },
    [EAgentRole.Quick]: { model: AUTO_MODEL },
    [EAgentRole.Compaction]: { model: AUTO_MODEL },
  },
  [EPreset.Thorough]: {
    [EAgentRole.Main]: {
      model: 'anthropic/claude-opus-5',
      effort: EEffortLevel.Max,
    },
    [EAgentRole.Subagents]: { model: 'anthropic/claude-opus-5' },
    [EAgentRole.Quick]: { model: 'anthropic/claude-sonnet-5' },
    [EAgentRole.Compaction]: { model: AUTO_MODEL },
  },
}

export enum EProviderId {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
}

export type ApiKeyEntry = { id: string; label: string; added: string }

export type ApiKeyProvider = {
  id: EProviderId
  name: string
  brand: EBrand
  description: string
}

export const API_KEY_PROVIDERS: ApiKeyProvider[] = [
  {
    id: EProviderId.Anthropic,
    name: 'Anthropic',
    brand: EBrand.Anthropic,
    description: 'Claude Opus and Claude Sonnet',
  },
  {
    id: EProviderId.OpenAI,
    name: 'OpenAI',
    brand: EBrand.OpenAI,
    description: 'GPT-5 and GPT-5 mini',
  },
  {
    id: EProviderId.OpenRouter,
    name: 'OpenRouter',
    brand: EBrand.OpenRouter,
    description: 'Any model behind one key',
  },
  {
    id: EProviderId.Inference,
    name: 'Inference.net',
    brand: EBrand.Inference,
    description: 'Open models on managed inference',
  },
]

export const KEY_PREFIXES: Record<EProviderId, string> = {
  [EProviderId.Anthropic]: 'sk-ant-',
  [EProviderId.OpenAI]: 'sk-proj-',
  [EProviderId.OpenRouter]: 'sk-or-',
  [EProviderId.Inference]: 'sk-inference-',
}
