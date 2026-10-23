import { EBrand } from '@dltech/atlas-ui/components/brand-mark'

export const INSTRUCTIONS_CHAR_LIMIT = 8000

export const GLOBAL_INSTRUCTIONS = `# Global Instructions
Machine-wide rules for every repository.

## Git
- Never add Co-Authored-By trailers or "Generated with" attribution to commit messages.
  Write plain conventional commits: <type>(<scope>): <description>, imperative, lowercase.
- Branch from origin/main as dennis/<slug>. Never force-push, never --no-verify, never git stash.
- Open a draft PR when work starts, mark it ready when scope is complete, merge with
  gh pr merge --squash once checks pass.

## Worktrees
- The main checkout is read-only: never checkout, switch, commit, or rebase in it.
- All work happens in a worktree under .atlas/worktrees/<slug>. Create it with
  git worktree add .atlas/worktrees/<slug> -b dennis/<slug> origin/main, then enter it by path.
- After the PR merges, remove the worktree and delete the local branch with -D.

## Code
- Strict TypeScript. No as any, no @ts-ignore. Early returns over nested conditionals.
- Do not write comments unless the fact lives outside the repository.
- Max 300 lines per file; split into focused modules.
- Every new feature ships with tests. Run the specs for the files you touched, not the suite.

## Communication
- Lead with the outcome, then the evidence. Point at code as path:line.
- If something looks wrong, say so in a sentence and stop; do not relitigate once I repeat it.
- Questions end the turn. Do not build while waiting for an answer.
`

export const GLOBAL_INSTRUCTIONS_RICH = `# Global Instructions
Machine-wide rules for every repository.

## Git
- Never add Co-Authored-By trailers or "Generated with" attribution to commit messages.
  Write plain conventional commits: \`<type>(<scope>): <description>\`, imperative, lowercase.
- Branch from origin/main as \`dennis/<slug>\`. Never force-push, never --no-verify, never git stash.
- Open a draft PR when work starts, mark it ready when scope is complete, merge with
  gh pr merge --squash once checks pass.

## Worktrees
- The main checkout is read-only: never checkout, switch, commit, or rebase in it.
- All work happens in a worktree under \`.atlas/worktrees/<slug>\`. Create it with
  \`git worktree add .atlas/worktrees/<slug> -b dennis/<slug> origin/main\`, then enter it by path.
- After the PR merges, remove the worktree and delete the local branch with -D.

## Code
- Strict TypeScript. No as any, no @ts-ignore. Early returns over nested conditionals.
- Do not write comments unless the fact lives outside the repository.
- Max 300 lines per file; split into focused modules.
- Every new feature ships with tests. Run the specs for the files you touched, not the suite.

## Communication
- Lead with the outcome, then the evidence. Point at code as path:line.
- If something looks wrong, say so in a sentence and stop; do not relitigate once I repeat it.
- Questions end the turn. Do not build while waiting for an answer.
`

const OVER_LIMIT_FILLER_LINES = 90

export const OVER_LIMIT_INSTRUCTIONS = `${GLOBAL_INSTRUCTIONS_RICH}
## Reviews
${Array.from(
  { length: OVER_LIMIT_FILLER_LINES },
  (_, index) =>
    `- Review rule ${index + 1}: state the finding, the evidence, then the smallest fix.`,
).join('\n')}
`

export enum EProviderId {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  OpenRouter = 'openrouter',
  Inference = 'inference',
  Gateway = 'gateway',
}

export type ApiKeyEntry = { masked: string; added: string }

export type ApiKeyProvider = {
  id: EProviderId
  name: string
  brand: EBrand | null
  envVar: string
  description: string
  key: ApiKeyEntry | null
}

export const API_KEY_PROVIDERS: ApiKeyProvider[] = [
  {
    id: EProviderId.Anthropic,
    name: 'Anthropic',
    brand: EBrand.Anthropic,
    envVar: 'ANTHROPIC_API_KEY',
    description: 'Claude Opus, Sonnet and Haiku',
    key: { masked: 'sk-ant-…a91f', added: 'Added Oct 2' },
  },
  {
    id: EProviderId.OpenAI,
    name: 'OpenAI',
    brand: EBrand.OpenAI,
    envVar: 'OPENAI_API_KEY',
    description: 'GPT-5 and GPT-5 mini',
    key: { masked: 'sk-proj-…7c0d', added: 'Added Sep 18' },
  },
  {
    id: EProviderId.OpenRouter,
    name: 'OpenRouter',
    brand: EBrand.OpenRouter,
    envVar: 'OPENROUTER_API_KEY',
    description: 'Any model behind one key',
    key: null,
  },
  {
    id: EProviderId.Inference,
    name: 'Inference.net',
    brand: null,
    envVar: 'INFERENCE_API_KEY',
    description: 'Open models on managed inference',
    key: null,
  },
  {
    id: EProviderId.Gateway,
    name: 'Vercel AI Gateway',
    brand: EBrand.Vercel,
    envVar: 'AI_GATEWAY_API_KEY',
    description: 'Models from every major lab behind one key.',
    key: null,
  },
]

export const KEY_PREFIXES: Partial<Record<EProviderId, string>> = {
  [EProviderId.Anthropic]: 'sk-ant-',
  [EProviderId.OpenAI]: 'sk-proj-',
  [EProviderId.OpenRouter]: 'sk-or-',
}

export const UNKNOWN_PREFIX_MASK = '••••'

export enum EUsageWindow {
  FiveHour = 'fiveHour',
  SevenDay = 'sevenDay',
}

export type UsageReading = {
  window: EUsageWindow
  utilization: number | null
  resetsAt: string
}

export type SubscriptionAccount = {
  email: string
  plan: string
  usage: UsageReading[]
}

export const CLAUDE_SUBSCRIPTION: SubscriptionAccount = {
  email: 'dennis@dltech.dev',
  plan: 'Max',
  usage: [
    { window: EUsageWindow.FiveHour, utilization: 62, resetsAt: 'in 2h 14m' },
    { window: EUsageWindow.SevenDay, utilization: 41, resetsAt: 'Mon 9:00' },
  ],
}

export const CLAUDE_SUBSCRIPTION_NEAR_LIMIT: SubscriptionAccount = {
  ...CLAUDE_SUBSCRIPTION,
  usage: [
    { window: EUsageWindow.FiveHour, utilization: 96, resetsAt: 'in 38m' },
    { window: EUsageWindow.SevenDay, utilization: 73, resetsAt: 'Mon 9:00' },
  ],
}

export const CHATGPT_SUBSCRIPTION: SubscriptionAccount = {
  email: 'dennis@dltech.dev',
  plan: 'Plus',
  usage: [
    { window: EUsageWindow.FiveHour, utilization: 12, resetsAt: 'in 4h 31m' },
    { window: EUsageWindow.SevenDay, utilization: 34, resetsAt: 'Sun 18:00' },
  ],
}

export const CHATGPT_SUBSCRIPTION_NEAR_LIMIT: SubscriptionAccount = {
  ...CHATGPT_SUBSCRIPTION,
  usage: [
    { window: EUsageWindow.FiveHour, utilization: 12, resetsAt: 'in 4h 31m' },
    { window: EUsageWindow.SevenDay, utilization: 88, resetsAt: 'Sun 18:00' },
  ],
}
