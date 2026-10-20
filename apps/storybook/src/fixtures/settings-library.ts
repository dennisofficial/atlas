export enum ESecretKind {
  Secret = "secret",
  EnvVar = "env",
}

export enum ELibraryScope {
  Personal = "personal",
  Workspace = "workspace",
}

export type LibraryMember = {
  name: string;
  initials: string;
};

export type LibrarySecret = {
  id: string;
  key: string;
  kind: ESecretKind;
  value: string;
  updated: string;
  addedBy: LibraryMember;
};

const DENNIS: LibraryMember = { name: "Dennis Lysenko", initials: "DL" };
const MAYA: LibraryMember = { name: "Maya Chen", initials: "MC" };
const TOMAS: LibraryMember = { name: "Tomás Rivera", initials: "TR" };
const PRIYA: LibraryMember = { name: "Priya Nair", initials: "PN" };

export const PERSONAL_SECRETS: LibrarySecret[] = [
  { id: "p1", key: "ANTHROPIC_API_KEY", kind: ESecretKind.Secret, value: "sk-ant-api03-w8Kq", updated: "3d ago", addedBy: DENNIS },
  { id: "p2", key: "OPENAI_API_KEY", kind: ESecretKind.Secret, value: "sk-proj-m4Rz", updated: "3d ago", addedBy: DENNIS },
  { id: "p3", key: "VERCEL_TOKEN", kind: ESecretKind.Secret, value: "vcp_9fT2xLq", updated: "2w ago", addedBy: DENNIS },
  { id: "p4", key: "NPM_TOKEN", kind: ESecretKind.Secret, value: "npm_hd7Q1vB", updated: "6w ago", addedBy: DENNIS },
  { id: "p5", key: "ATLAS_LOG_LEVEL", kind: ESecretKind.EnvVar, value: "debug", updated: "1d ago", addedBy: DENNIS },
  { id: "p6", key: "NODE_ENV", kind: ESecretKind.EnvVar, value: "development", updated: "5w ago", addedBy: DENNIS },
];

export const WORKSPACE_SECRETS: LibrarySecret[] = [
  { id: "w1", key: "DATABASE_URL", kind: ESecretKind.Secret, value: "postgres://rs_app:x9@db.dltech.dev/rs", updated: "4d ago", addedBy: DENNIS },
  { id: "w2", key: "SENTRY_AUTH_TOKEN", kind: ESecretKind.Secret, value: "sntrys_eyJp", updated: "1w ago", addedBy: MAYA },
  { id: "w3", key: "LINEAR_API_KEY", kind: ESecretKind.Secret, value: "lin_api_Qe3", updated: "2w ago", addedBy: TOMAS },
  { id: "w4", key: "STRIPE_TEST_KEY", kind: ESecretKind.Secret, value: "sk_test_51Nq", updated: "3w ago", addedBy: PRIYA },
  { id: "w5", key: "VERCEL_TEAM_ID", kind: ESecretKind.EnvVar, value: "team_dltech", updated: "8w ago", addedBy: DENNIS },
  { id: "w6", key: "ATLAS_DEFAULT_REGION", kind: ESecretKind.EnvVar, value: "iad1", updated: "8w ago", addedBy: MAYA },
];

export enum ESkillSource {
  User = "User",
  Project = "Project",
  BuiltIn = "Built-in",
}

export type LibrarySkill = {
  id: string;
  name: string;
  description: string;
  source: ESkillSource;
  enabled: boolean;
};

export const INSTALLED_SKILLS: LibrarySkill[] = [
  { id: "s1", name: "ui-design", description: "Default guidance for designing, building, and reviewing web, mobile, and terminal interfaces.", source: ESkillSource.User, enabled: true },
  { id: "s2", name: "code-review", description: "Review changes since a fixed point along standards and spec axes.", source: ESkillSource.Project, enabled: true },
  { id: "s3", name: "tdd", description: "Test-driven development: red, green, refactor with integration tests.", source: ESkillSource.User, enabled: true },
  { id: "s4", name: "playwright-cli", description: "Automate browser interactions, test web pages, and take screenshots.", source: ESkillSource.User, enabled: false },
];

export const BUILT_IN_SKILLS: LibrarySkill[] = [
  { id: "b1", name: "commit", description: "Stage the current work and write a conventional commit message.", source: ESkillSource.BuiltIn, enabled: true },
  { id: "b2", name: "handoff", description: "Compact the conversation into a handoff document for another agent.", source: ESkillSource.BuiltIn, enabled: true },
  { id: "b3", name: "research", description: "Investigate a question against primary sources and capture findings in the repo.", source: ESkillSource.BuiltIn, enabled: true },
];

export type LibraryPlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  hooks: number;
  tools: number;
  promptFragments: number;
  enabled: boolean;
};

export const PLUGINS: LibraryPlugin[] = [
  { id: "pl1", name: "Lint Guard", version: "0.4.2", description: "Runs the repo's linter after every file edit and feeds failures back to the agent.", hooks: 2, tools: 0, promptFragments: 1, enabled: true },
  { id: "pl2", name: "Linear Sync", version: "1.2.0", description: "Links threads to Linear issues and moves them as the pull request progresses.", hooks: 1, tools: 3, promptFragments: 1, enabled: true },
  { id: "pl3", name: "Sentry Triage", version: "0.9.1", description: "Pulls recent Sentry issues into context and proposes fixes with stack traces.", hooks: 0, tools: 3, promptFragments: 1, enabled: true },
  { id: "pl4", name: "Slack Notify", version: "0.2.0", description: "Posts a thread summary to Slack when a pull request opens or CI fails.", hooks: 2, tools: 0, promptFragments: 0, enabled: false },
];
