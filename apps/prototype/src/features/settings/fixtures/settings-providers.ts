import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export enum EProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
  Gateway = 'gateway',
  Typesafe = 'typesafe',
}

export enum EAccountKind {
  Plan = 'plan',
  ApiKey = 'api-key',
}

export type UsageMeter = { window: string; percent: number; resets: string }

export type ProviderAccount = {
  id: string
  kind: EAccountKind
  name: string
  plan?: string
  masked?: string
  added: string
  usage: UsageMeter[]
}

export type ProviderInfo = {
  id: EProvider
  name: string
  brand: EBrand
  description: string
  envVar: string
  keyPrefix: string | null
  plan: { product: string; signInLabel: string; pitch: string } | null
}

export type ProviderState = {
  accounts: Record<EProvider, ProviderAccount[]>
  inUse: Record<EProvider, string | null>
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: EProvider.Anthropic,
    name: 'Anthropic',
    brand: EBrand.Anthropic,
    description: 'Claude Opus, Sonnet and Haiku',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    plan: {
      product: 'Claude',
      signInLabel: 'Sign in with Claude',
      pitch: 'Use a Claude Pro, Max or Team plan',
    },
  },
  {
    id: EProvider.OpenAI,
    name: 'OpenAI',
    brand: EBrand.OpenAI,
    description: 'GPT-5 and GPT-5 mini',
    envVar: 'OPENAI_API_KEY',
    keyPrefix: 'sk-proj-',
    plan: {
      product: 'ChatGPT',
      signInLabel: 'Sign in with ChatGPT',
      pitch: 'Use a ChatGPT Plus, Pro or Business plan',
    },
  },
  {
    id: EProvider.OpenRouter,
    name: 'OpenRouter',
    brand: EBrand.OpenRouter,
    description: 'Any model behind one key',
    envVar: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    plan: null,
  },
  {
    id: EProvider.Inference,
    name: 'Inference.net',
    brand: EBrand.Inference,
    description: 'Open models on managed inference',
    envVar: 'INFERENCE_API_KEY',
    keyPrefix: null,
    plan: null,
  },
  {
    id: EProvider.Gateway,
    name: 'Vercel AI Gateway',
    brand: EBrand.Vercel,
    description: 'Models from every major lab behind one key',
    envVar: 'AI_GATEWAY_API_KEY',
    keyPrefix: 'vck_',
    plan: null,
  },
  {
    id: EProvider.Typesafe,
    name: 'TypeSafe AI',
    brand: EBrand.Typesafe,
    description: 'Jev, the decision model behind the classifier. Not a chat model.',
    envVar: 'TYPESAFE_API_KEY',
    keyPrefix: null,
    plan: null,
  },
]

const CLAUDE_PERSONAL: ProviderAccount = {
  id: 'acc-claude-personal',
  kind: EAccountKind.Plan,
  name: 'dennislysenko@hotmail.com',
  plan: 'Max',
  added: 'Signed in Oct 12',
  usage: [{ window: 'Weekly', percent: 35, resets: '1d 13h' }],
}

const CLAUDE_WORK: ProviderAccount = {
  id: 'acc-claude-work',
  kind: EAccountKind.Plan,
  name: 'dennis@trycomp.ai',
  plan: 'Team',
  added: 'Signed in Nov 14',
  usage: [],
}

const CHATGPT_PERSONAL: ProviderAccount = {
  id: 'acc-chatgpt-personal',
  kind: EAccountKind.Plan,
  name: 'dennis.elementauto@gmail.com',
  plan: 'Pro',
  added: 'Signed in Oct 20',
  usage: [{ window: 'Weekly', percent: 12, resets: '2d 18h' }],
}

const CHATGPT_WORK: ProviderAccount = {
  id: 'acc-chatgpt-work',
  kind: EAccountKind.Plan,
  name: 'dennis@trycomp.ai',
  plan: 'Business',
  added: 'Signed in Nov 14',
  usage: [{ window: 'Weekly', percent: 0, resets: '7d' }],
}

const apiKey = (args: { id: string; name: string; masked: string; added: string }) => ({
  ...args,
  kind: EAccountKind.ApiKey,
  usage: [],
})

const INFERENCE_KEY = apiKey({
  id: 'acc-inference',
  name: 'Inference.net api key',
  masked: '••••8c1e',
  added: 'Added Oct 31',
})

const GATEWAY_KEY = apiKey({
  id: 'acc-gateway',
  name: 'Personal',
  masked: 'vck_…3b7a',
  added: 'Added Nov 7',
})

const NOBODY: ProviderState['inUse'] = {
  [EProvider.Anthropic]: null,
  [EProvider.OpenAI]: null,
  [EProvider.OpenRouter]: null,
  [EProvider.Inference]: null,
  [EProvider.Gateway]: null,
  [EProvider.Typesafe]: null,
}

const NO_ACCOUNTS: ProviderState['accounts'] = {
  [EProvider.Anthropic]: [],
  [EProvider.OpenAI]: [],
  [EProvider.OpenRouter]: [],
  [EProvider.Inference]: [],
  [EProvider.Gateway]: [],
  [EProvider.Typesafe]: [],
}

export const CURRENT_PROVIDERS: ProviderState = {
  accounts: {
    ...NO_ACCOUNTS,
    [EProvider.Anthropic]: [CLAUDE_PERSONAL, CLAUDE_WORK],
    [EProvider.OpenAI]: [CHATGPT_PERSONAL, CHATGPT_WORK],
    [EProvider.Inference]: [INFERENCE_KEY],
    [EProvider.Gateway]: [GATEWAY_KEY],
  },
  inUse: {
    ...NOBODY,
    [EProvider.Anthropic]: CLAUDE_PERSONAL.id,
    [EProvider.OpenAI]: CHATGPT_PERSONAL.id,
    [EProvider.Inference]: INFERENCE_KEY.id,
    [EProvider.Gateway]: GATEWAY_KEY.id,
  },
}

export const SEVERAL_KEYS_PROVIDERS: ProviderState = {
  accounts: {
    ...CURRENT_PROVIDERS.accounts,
    [EProvider.Anthropic]: [
      CLAUDE_PERSONAL,
      CLAUDE_WORK,
      apiKey({ id: 'acc-ant-work', name: 'Work', masked: 'sk-ant-…4f2a', added: 'Added Nov 3' }),
      apiKey({ id: 'acc-ant-ci', name: 'CI', masked: 'sk-ant-…90bd', added: 'Added Nov 18' }),
    ],
    [EProvider.OpenRouter]: [
      apiKey({ id: 'acc-or', name: 'Personal', masked: 'sk-or-…77c2', added: 'Added Nov 9' }),
    ],
    [EProvider.Gateway]: [
      GATEWAY_KEY,
      apiKey({ id: 'acc-gateway-team', name: 'Team', masked: 'vck_…e01c', added: 'Added Nov 21' }),
    ],
  },
  inUse: {
    ...CURRENT_PROVIDERS.inUse,
    [EProvider.Anthropic]: 'acc-ant-work',
    [EProvider.OpenRouter]: 'acc-or',
  },
}

export const NEAR_LIMIT_PROVIDERS: ProviderState = {
  ...CURRENT_PROVIDERS,
  accounts: {
    ...CURRENT_PROVIDERS.accounts,
    [EProvider.Anthropic]: [
      {
        ...CLAUDE_PERSONAL,
        usage: [
          { window: '5-hour', percent: 96, resets: '38m' },
          { window: 'Weekly', percent: 88, resets: '1d 13h' },
        ],
      },
      CLAUDE_WORK,
    ],
  },
}

export const EMPTY_PROVIDERS: ProviderState = { accounts: NO_ACCOUNTS, inUse: NOBODY }
