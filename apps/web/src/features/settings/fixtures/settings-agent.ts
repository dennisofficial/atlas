import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export const INSTRUCTIONS_CHAR_LIMIT = 8000

export enum EBuiltInAgentType {
  Builder = 'builder',
  Explore = 'explore',
  GeneralPurpose = 'general-purpose',
  Preview = 'preview',
  Reviewer = 'reviewer',
}

export enum EProviderId {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
  Gateway = 'gateway',
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
  {
    id: EProviderId.Gateway,
    name: 'Vercel AI Gateway',
    brand: EBrand.Vercel,
    description: 'Every major model behind one key, billed through Vercel',
  },
]

export const KEY_PREFIXES: Record<EProviderId, string> = {
  [EProviderId.Anthropic]: 'sk-ant-',
  [EProviderId.OpenAI]: 'sk-proj-',
  [EProviderId.OpenRouter]: 'sk-or-',
  [EProviderId.Inference]: 'sk-inference-',
  [EProviderId.Gateway]: '',
}
