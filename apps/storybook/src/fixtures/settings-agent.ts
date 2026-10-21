import { EBrand } from "@dltech/atlas-ui/components/brand-mark";

export const INSTRUCTIONS_CHAR_LIMIT = 8000;

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
`;

export enum EAgentRole {
  Main = "main",
  Subagents = "subagents",
  Classifiers = "classifiers",
}

export enum EEffort {
  Low = "low",
  Medium = "medium",
  High = "high",
  Max = "max",
}

export enum EPreset {
  Fast = "fast",
  Balanced = "balanced",
  Thorough = "thorough",
}

export const EFFORT_STEPS: { effort: EEffort; label: string }[] = [
  { effort: EEffort.Low, label: "Low" },
  { effort: EEffort.Medium, label: "Medium" },
  { effort: EEffort.High, label: "High" },
  { effort: EEffort.Max, label: "Max" },
];

export const AUTO_MODEL = "auto";

export type RoleSetting = { model: string; effort: EEffort };
export type ModelsConfig = Record<EAgentRole, RoleSetting>;

export type ModelChoice = { id: string; label: string };
export type ModelGroup = { provider: string; models: ModelChoice[] };

export const MODEL_GROUPS: ModelGroup[] = [
  {
    provider: "Anthropic",
    models: [
      { id: "claude-opus", label: "Claude Opus" },
      { id: "claude-sonnet", label: "Claude Sonnet" },
    ],
  },
  {
    provider: "OpenAI",
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
    ],
  },
];

export const ROLE_META: Record<
  EAgentRole,
  { title: string; description: string; autoLabel: string }
> = {
  [EAgentRole.Main]: {
    title: "Main agent",
    description: "Plans the work, edits code, and talks to you in the thread.",
    autoLabel: "Auto · Claude Opus",
  },
  [EAgentRole.Subagents]: {
    title: "Subagents",
    description: "Parallel workers the main agent spawns for search, review, and builds.",
    autoLabel: "Auto · Claude Sonnet",
  },
  [EAgentRole.Classifiers]: {
    title: "Classifiers",
    description: "Small background calls: the guardrail check and the tl;dr feed.",
    autoLabel: "Auto · GPT-5 mini",
  },
};

export const ROLE_ORDER: EAgentRole[] = [
  EAgentRole.Main,
  EAgentRole.Subagents,
  EAgentRole.Classifiers,
];

export const PRESET_LABELS: Record<EPreset, string> = {
  [EPreset.Fast]: "Fast",
  [EPreset.Balanced]: "Balanced",
  [EPreset.Thorough]: "Thorough",
};

export const PRESETS: Record<EPreset, ModelsConfig> = {
  [EPreset.Fast]: {
    [EAgentRole.Main]: { model: "claude-sonnet", effort: EEffort.Low },
    [EAgentRole.Subagents]: { model: "gpt-5-mini", effort: EEffort.Low },
    [EAgentRole.Classifiers]: { model: "gpt-5-mini", effort: EEffort.Low },
  },
  [EPreset.Balanced]: {
    [EAgentRole.Main]: { model: AUTO_MODEL, effort: EEffort.Medium },
    [EAgentRole.Subagents]: { model: AUTO_MODEL, effort: EEffort.Medium },
    [EAgentRole.Classifiers]: { model: AUTO_MODEL, effort: EEffort.Low },
  },
  [EPreset.Thorough]: {
    [EAgentRole.Main]: { model: "claude-opus", effort: EEffort.Max },
    [EAgentRole.Subagents]: { model: "claude-opus", effort: EEffort.High },
    [EAgentRole.Classifiers]: { model: "claude-sonnet", effort: EEffort.Medium },
  },
};

export const DEFAULT_MODELS_CONFIG: ModelsConfig = PRESETS[EPreset.Balanced];

export const EDITED_MODELS_CONFIG: ModelsConfig = {
  [EAgentRole.Main]: { model: AUTO_MODEL, effort: EEffort.High },
  [EAgentRole.Subagents]: { model: "gpt-5", effort: EEffort.Medium },
  [EAgentRole.Classifiers]: { model: AUTO_MODEL, effort: EEffort.Low },
};

export enum EProviderId {
  Anthropic = "anthropic",
  OpenAI = "openai",
  Google = "google",
  OpenRouter = "openrouter",
}

export type ApiKeyEntry = { masked: string; added: string };

export type ApiKeyProvider = {
  id: EProviderId;
  name: string;
  brand: EBrand;
  description: string;
  key: ApiKeyEntry | null;
};

export const API_KEY_PROVIDERS: ApiKeyProvider[] = [
  {
    id: EProviderId.Anthropic,
    name: "Anthropic",
    brand: EBrand.Anthropic,
    description: "Claude Opus and Claude Sonnet",
    key: { masked: "sk-ant-…a91f", added: "Added Oct 2" },
  },
  {
    id: EProviderId.OpenAI,
    name: "OpenAI",
    brand: EBrand.OpenAI,
    description: "GPT-5 and GPT-5 mini",
    key: { masked: "sk-proj-…7c0d", added: "Added Sep 18" },
  },
  {
    id: EProviderId.Google,
    name: "Google",
    brand: EBrand.Gemini,
    description: "Gemini models",
    key: null,
  },
  {
    id: EProviderId.OpenRouter,
    name: "OpenRouter",
    brand: EBrand.OpenRouter,
    description: "Any model behind one key",
    key: null,
  },
];

export const KEY_PREFIXES: Record<EProviderId, string> = {
  [EProviderId.Anthropic]: "sk-ant-",
  [EProviderId.OpenAI]: "sk-proj-",
  [EProviderId.Google]: "AIza",
  [EProviderId.OpenRouter]: "sk-or-",
};

export const CLAUDE_SUBSCRIPTION = {
  email: "dennis@dltech.dev",
  plan: "Max",
  limitUsedPercent: 62,
  limitHint: "62% of the 5-hour limit used · resets in 2h 14m",
};

export const CHATGPT_SUBSCRIPTION = {
  email: "dennis@dltech.dev",
  plan: "Plus",
  limitUsedPercent: 18,
  limitHint: "18% of the weekly Codex limit used · resets Sunday",
};
