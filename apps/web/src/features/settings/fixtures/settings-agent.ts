import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export { INSTRUCTIONS_CHAR_LIMIT } from '@dltech/atlas-client/settings'

export { EBuiltInAgentType } from '@dltech/atlas-client/settings'

export enum EProviderId {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
  Gateway = 'gateway',
  Typesafe = 'typesafe',
}

export type ProviderPlan = {
  product: string
  signInLabel: string
  pitch: string
}

export type ProviderInfo = {
  id: EProviderId
  name: string
  brand: EBrand
  description: string
  keyPrefix: string
  plan?: ProviderPlan
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: EProviderId.Anthropic,
    name: 'Anthropic',
    brand: EBrand.Anthropic,
    description: 'Claude Opus, Sonnet and Haiku',
    keyPrefix: 'sk-ant-',
    plan: {
      product: 'Claude',
      signInLabel: 'Sign in with Claude',
      pitch: 'Use a Claude Pro, Max or Team plan',
    },
  },
  {
    id: EProviderId.OpenAI,
    name: 'OpenAI',
    brand: EBrand.OpenAI,
    description: 'GPT-5 and GPT-5 mini',
    keyPrefix: 'sk-proj-',
    plan: {
      product: 'ChatGPT',
      signInLabel: 'Sign in with ChatGPT',
      pitch: 'Use a ChatGPT Plus, Pro or Business plan',
    },
  },
  {
    id: EProviderId.OpenRouter,
    name: 'OpenRouter',
    brand: EBrand.OpenRouter,
    description: 'Any model behind one key',
    keyPrefix: 'sk-or-',
  },
  {
    id: EProviderId.Inference,
    name: 'Inference.net',
    brand: EBrand.Inference,
    description: 'Open models on managed inference',
    keyPrefix: 'sk-inference-',
  },
  {
    id: EProviderId.Gateway,
    name: 'Vercel AI Gateway',
    brand: EBrand.Vercel,
    description: 'Models from every major lab behind one key',
    keyPrefix: '',
  },
  {
    id: EProviderId.Typesafe,
    name: 'TypeSafe AI',
    brand: EBrand.Typesafe,
    description: 'Jev, the decision model behind the classifier. Not a chat model.',
    keyPrefix: '',
  },
]
