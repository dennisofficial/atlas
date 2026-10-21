export const INSTRUCTIONS_CHAR_LIMIT = 8000

export enum EAgentRole {
  Main = 'main',
  Subagents = 'subagents',
  Classifiers = 'classifiers',
}

export enum EEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Max = 'max',
}

export enum EPreset {
  Fast = 'fast',
  Balanced = 'balanced',
  Thorough = 'thorough',
}

export const EFFORT_STEPS: { effort: EEffort; label: string }[] = [
  { effort: EEffort.Low, label: 'Low' },
  { effort: EEffort.Medium, label: 'Medium' },
  { effort: EEffort.High, label: 'High' },
  { effort: EEffort.Max, label: 'Max' },
]

export const AUTO_MODEL = 'auto'

export type RoleSetting = { model: string; effort: EEffort }
export type ModelsConfig = Record<EAgentRole, RoleSetting>

export type ModelChoice = { id: string; label: string }
export type ModelGroup = { provider: string; models: ModelChoice[] }

export const MODEL_GROUPS: ModelGroup[] = [
  {
    provider: 'Anthropic',
    models: [
      { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5' },
      { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' },
    ],
  },
  {
    provider: 'OpenAI',
    models: [
      { id: 'openai/gpt-5', label: 'GPT-5' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 mini' },
    ],
  },
]

export const ROLE_META: Record<
  EAgentRole,
  { title: string; description: string; autoLabel: string }
> = {
  [EAgentRole.Main]: {
    title: 'Main agent',
    description: 'Plans the work, edits code, and talks to you in the thread.',
    autoLabel: 'Auto · Claude Opus',
  },
  [EAgentRole.Subagents]: {
    title: 'Subagents',
    description: 'Parallel workers the main agent spawns for search, review, and builds.',
    autoLabel: 'Auto · Claude Sonnet',
  },
  [EAgentRole.Classifiers]: {
    title: 'Classifiers',
    description: 'Small background calls: the guardrail check and the tl;dr feed.',
    autoLabel: 'Auto · GPT-5 mini',
  },
}

export const ROLE_ORDER: EAgentRole[] = [
  EAgentRole.Main,
  EAgentRole.Subagents,
  EAgentRole.Classifiers,
]

export const PRESET_LABELS: Record<EPreset, string> = {
  [EPreset.Fast]: 'Fast',
  [EPreset.Balanced]: 'Balanced',
  [EPreset.Thorough]: 'Thorough',
}

export const PRESETS: Record<EPreset, ModelsConfig> = {
  [EPreset.Fast]: {
    [EAgentRole.Main]: { model: 'anthropic/claude-sonnet-5', effort: EEffort.Low },
    [EAgentRole.Subagents]: { model: 'openai/gpt-5-mini', effort: EEffort.Low },
    [EAgentRole.Classifiers]: { model: 'openai/gpt-5-mini', effort: EEffort.Low },
  },
  [EPreset.Balanced]: {
    [EAgentRole.Main]: { model: AUTO_MODEL, effort: EEffort.Medium },
    [EAgentRole.Subagents]: { model: AUTO_MODEL, effort: EEffort.Medium },
    [EAgentRole.Classifiers]: { model: AUTO_MODEL, effort: EEffort.Low },
  },
  [EPreset.Thorough]: {
    [EAgentRole.Main]: { model: 'anthropic/claude-opus-5', effort: EEffort.Max },
    [EAgentRole.Subagents]: { model: 'anthropic/claude-opus-5', effort: EEffort.High },
    [EAgentRole.Classifiers]: { model: 'anthropic/claude-sonnet-5', effort: EEffort.Medium },
  },
}

export enum EProviderId {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
}

export type ApiKeyEntry = { id: string; label: string; added: string }

export type ApiKeyProvider = {
  id: EProviderId
  name: string
  letter: string
  description: string
}

export const API_KEY_PROVIDERS: ApiKeyProvider[] = [
  {
    id: EProviderId.Anthropic,
    name: 'Anthropic',
    letter: 'A',
    description: 'Claude Opus and Claude Sonnet',
  },
  {
    id: EProviderId.OpenAI,
    name: 'OpenAI',
    letter: 'O',
    description: 'GPT-5 and GPT-5 mini',
  },
  {
    id: EProviderId.OpenRouter,
    name: 'OpenRouter',
    letter: 'R',
    description: 'Any model behind one key',
  },
]

export const KEY_PREFIXES: Record<EProviderId, string> = {
  [EProviderId.Anthropic]: 'sk-ant-',
  [EProviderId.OpenAI]: 'sk-proj-',
  [EProviderId.OpenRouter]: 'sk-or-',
}
